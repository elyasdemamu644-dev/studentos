// ──────────────────────────────────────────────────────────────────────────────
// Structured extraction — the schema-validated AI endpoint
// ──────────────────────────────────────────────────────────────────────────────
// `POST /api/v1/ai/structured` turns a prompt + a bounded JSON Schema into a
// schema-validated JSON value. It deliberately reuses the grounded no-tools
// chat path (`AiProvider.chat` + `studentContextBuilder`), so no parallel AI
// system exists and nothing new needs a provider credential. The output is then
// hardened in three steps:
//
//   1. the model text is parsed as JSON (markdown code fences tolerated);
//   2. the parsed value is validated against a Zod schema converted from the
//      client's JSON Schema (`jsonSchemaToZod` in the tool layer);
//   3. one corrective retry is made when the first reply did not parse or match;
//   4. still wrong → 502 `AI_STRUCTURED_OUTPUT_INVALID` — never raw model text.
//
// This is a pure read path: it executes no tools and writes nothing, so there is
// never a proposal to confirm and no confirmation-store machinery is involved.

import { z } from "zod";

import { validationError } from "@/config/errors";
import { studentContextBuilder } from "./context";
import { jsonSchemaToZod } from "./tools/json-schema";
import type { JsonSchemaObject } from "./tools/types";
import {
  AiStructuredOutputError,
  AiProviderNotConfiguredError,
  getAIProvider,
  type AiProviderName,
} from "./provider";

/** The system-style instruction glued into the task message. */
function schemaInstruction(schemaText: string): string {
  return (
    "You are Tutor Walle's structured extraction assistant. Return a single JSON value that " +
    "conforms EXACTLY to the JSON Schema below — no markdown fences, no prose before or " +
    "after, no extra keys, no missing fields, and no values of the wrong type. Reread the " +
    "schema and check your own JSON against it before answering.\n\n" +
    `Required output schema:\n${schemaText}`
  );
}

const REPAIR_MESSAGE = (problem: string) =>
  `Your previous reply failed validation. ${problem}\n` +
  "Reply again with ONLY a valid JSON value conforming to the exact schema from the " +
  "first message, and nothing else.";

export interface StructuredExtractionResult {
  /** The provider reply, parsed and validated against the client schema. */
  result: unknown;
  /** Whether the first reply failed and a corrective retry was used. */
  repaired: boolean;
  provider: AiProviderName;
  model: string;
}

export async function extractStructured(options: {
  userId: string;
  prompt: string;
  schema: Record<string, unknown>;
  ground: boolean;
}): Promise<StructuredExtractionResult> {
  const provider = await getAIProvider(options.userId);
  if (!provider.isConfigured()) throw new AiProviderNotConfiguredError();

  let validator: z.ZodTypeAny;
  try {
    validator = jsonSchemaToZod(options.schema as JsonSchemaObject);
  } catch {
    // The route's meta-schema already rejected most malformed shapes; this is
    // for the remainder (unknown type, dangling `required`, over-deep nesting).
    throw validationError("The provided schema is not a valid structured-output schema");
  }

  const schemaText = JSON.stringify(options.schema);
  const groundingLine = options.ground
    ? "Ground your answer in the student's own Tutor Walle data where relevant.\n"
    : "Do not invent facts that are not in the task.\n";
  const taskMessage = `${schemaInstruction(schemaText)}\n\n${groundingLine}Task:\n${options.prompt}`;

  // The no-tools grounded context snapshot; undefined when `ground: false`,
  // which makes `AiProvider.chat` omit the system grounding message entirely.
  const context = options.ground ? await studentContextBuilder.toPrompt(options.userId) : undefined;

  const call = (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    provider.chat({ messages, context });

  const first = await call([{ role: "user", content: taskMessage }]);
  const firstCheck = validateJsonContent(first.content, validator);
  if (firstCheck.ok) {
    return {
      result: firstCheck.value,
      repaired: false,
      provider: provider.providerName,
      model: provider.model,
    };
  }

  // One corrective retry with the model's own bad reply in the transcript so it
  // can see and fix exactly what was wrong. The failure text stays on the wire;
  // if this second try also fails, only the fixed `AiStructuredOutputError`
  // message ever reaches the client.
  const repair = await call([
    { role: "user", content: taskMessage },
    { role: "assistant", content: first.content },
    { role: "user", content: REPAIR_MESSAGE(firstCheck.problem) },
  ]);

  const repairCheck = validateJsonContent(repair.content, validator);
  if (!repairCheck.ok) throw new AiStructuredOutputError();

  return {
    result: repairCheck.value,
    repaired: true,
    provider: provider.providerName,
    model: provider.model,
  };
}

type ValidationCheck =
  | { ok: true; value: unknown }
  | { ok: false; problem: string };

/**
 * Extract a JSON value from a provider reply and validate it. Tolerates a
 * markdown code fence and stray prose around the JSON, and reports a short,
 * model-readable reason when it fails so the repair turn knows what to fix.
 */
function validateJsonContent(content: string, validator: z.ZodTypeAny): ValidationCheck {
  let text = content.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fence) text = fence[1].trim();

  const open = text.search(/[\[{]/);
  const closeChar = open >= 0 && text[open] === "[" ? "]" : "}";
  const close = open === -1 ? -1 : text.lastIndexOf(closeChar);
  if (open === -1 || close === -1 || close <= open) {
    return { ok: false, problem: "the reply contained no JSON value" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text.slice(open, close + 1));
  } catch {
    return { ok: false, problem: "the reply was not valid JSON" };
  }

  const parsed = validator.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problem: issue
        ? `field "${issue.path.join(".") || "<root>"}": ${issue.message}`
        : "the reply did not match the schema",
    };
  }
  return { ok: true, value: parsed.data };
}