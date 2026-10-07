import { z } from "zod";
import type { JsonSchemaObject } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Zod → JSON Schema (the subset tools actually use)
// ─────────────────────────────────────────────────────────────────────────────
//
// Tool argument schemas are converted to JSON Schema so the provider can see
// them in the OpenAI `tools` field. This deliberately covers only the Zod
// constructs the tool layer uses — object, string, number, integer, boolean,
// enum, array, optional, nullable and default. Anything else throws at
// registration time rather than silently producing a schema the model cannot
// satisfy, which keeps the failure loud and local.
//
// Hand-rolled instead of pulling in a converter package: the project has no
// runtime dependency on one and this covers 100% of the tool surface.

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const def = schema._def as { typeName?: string; [key: string]: unknown };
  const description = typeof def.description === "string" ? def.description : undefined;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const checks = (def.checks ?? []) as Array<Record<string, unknown>>;
      const min = checks.find((c) => c.kind === "min");
      const max = checks.find((c) => c.kind === "max");
      return withDescription(
        {
          type: "string",
          ...(min ? { minLength: min.value as number } : {}),
          ...(max ? { maxLength: max.value as number } : {}),
        },
        description,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodNumber:
    case z.ZodFirstPartyTypeKind.ZodBigInt: {
      const checks = (def.checks ?? []) as Array<Record<string, unknown>>;
      const isInt = checks.some((c) => c.kind === "int");
      const min = checks.find((c) => c.kind === "min");
      const max = checks.find((c) => c.kind === "max");
      return withDescription(
        {
          type: isInt ? "integer" : "number",
          ...(min ? { minimum: min.value as number } : {}),
          ...(max ? { maximum: max.value as number } : {}),
        },
        description,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return withDescription({ type: "boolean" }, description);

    // The bare `null` type, used as a union member for "clear this field".
    case z.ZodFirstPartyTypeKind.ZodNull:
      return { type: "null" };

    case z.ZodFirstPartyTypeKind.ZodUndefined:
      return {};

    case z.ZodFirstPartyTypeKind.ZodDate:
      return withDescription({ type: "string", description: "ISO-8601 date-time" }, description);

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return withDescription({ type: "string", enum: [...(def.values as string[])] }, description);

    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return withDescription({ type: "string", enum: [def.value] }, description);

    case z.ZodFirstPartyTypeKind.ZodArray: {
      const checks = (def.checks ?? []) as Array<Record<string, unknown>>;
      const min = checks.find((c) => c.kind === "min");
      const max = checks.find((c) => c.kind === "max");
      return withDescription(
        {
          type: "array",
          items: zodToJsonSchema(def.type as z.ZodTypeAny),
          ...(min ? { minItems: min.value as number } : {}),
          ...(max ? { maxItems: max.value as number } : {}),
        },
        description,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, JsonSchemaObject> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return withDescription(
        {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          // The parse strips unknown keys, so telling the model this up front
          // is what keeps `userId` (or any other invented field) out of args.
          additionalProperties: false,
        },
        description,
      );
    }

    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodDefault:
    case z.ZodFirstPartyTypeKind.ZodReadonly:
      return withDescription(zodToJsonSchema(def.innerType as z.ZodTypeAny), description);

    // `.refine()` / `.transform()` wrap the real schema. The refinement only
    // affects validation, so the JSON Schema keeps the inner type and the
    // wrapped schema's own description.
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return withDescription(zodToJsonSchema(def.schema as z.ZodTypeAny), description);

    case z.ZodFirstPartyTypeKind.ZodNullable:
      return {
        anyOf: [zodToJsonSchema(def.innerType as z.ZodTypeAny), { type: "null" }],
        ...(description ? { description } : {}),
      };

    // A union such as `string | null` is a plain `anyOf` of its options.
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = (def.options as z.ZodTypeAny[]).map((o) => zodToJsonSchema(o));
      return { anyOf: options, ...(description ? { description } : {}) };
    }

    default:
      throw new Error(
        `zodToJsonSchema: unsupported Zod type "${String(def.typeName)}" in a tool parameter schema`,
      );
  }
}

/** A schema the model may omit (optional, defaulted, or nullable-optional). */
function isOptional(schema: z.ZodTypeAny): boolean {
  const def = schema._def as { typeName?: string; [key: string]: unknown };
  if (
    def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    def.typeName === z.ZodFirstPartyTypeKind.ZodDefault
  ) {
    return true;
  }
  return schema.isOptional();
}

function withDescription(schema: JsonSchemaObject, description?: string): JsonSchemaObject {
  return description ? { ...schema, description } : schema;
}
