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

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema → Zod (the reverse direction, for the structured endpoint)
// ─────────────────────────────────────────────────────────────────────────────
//
// `POST /ai/structured` accepts the *bounded* subset this file emits and turns
// it back into a Zod validator, so a provider reply can be guaranteed to match
// the requested shape before the API returns it. The route's meta-schema
// rejects everything outside that subset (`$ref`, `oneOf`, `pattern`, …) before
// this function ever runs, and the conversion itself is capped at
// `MAX_SCHEMA_DEPTH` levels so deep client schemas fail loudly instead of
// recursing forever. Unknown keys on a validated object are stripped (the same
// semantics the tool layer relies on), so a model reply always comes back
// exactly as the schema describes it.

/** Deepest nested field schema the converter will walk. */
export const MAX_SCHEMA_DEPTH = 6;

export function jsonSchemaToZod(schema: JsonSchemaObject, depth = 0): z.ZodTypeAny {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(`JSON Schema nesting is deeper than the supported ${MAX_SCHEMA_DEPTH} levels`);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const options = schema.anyOf.map((option) => jsonSchemaToZod(option, depth + 1));
    const rest = options.filter(
      (option) => option._def.typeName !== z.ZodFirstPartyTypeKind.ZodNull,
    );
    // `anyOf: [X, { type: "null" }]` is how nullability is expressed; collapse
    // it to `.nullable()` so the field keeps working in optional positions.
    if (rest.length === 1 && options.length > rest.length) return rest[0].nullable();
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (schema.enum) {
    if (schema.enum.every((value) => typeof value === "string")) {
      return z.enum(schema.enum as [string, string, ...string[]]);
    }
    const literals = schema.enum.map((value) => {
      if (typeof value === "string") return z.literal(value);
      if (typeof value === "number") return z.literal(value);
      if (typeof value === "boolean") return z.literal(value);
      return z.null();
    });
    return literals.length === 1 ? literals[0] : z.union(literals as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  switch (schema.type) {
    case "object": {
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      // "Required" can only name fields that the schema actually defines.
      for (const key of required) {
        if (!properties[key]) throw new Error(`Required field "${key}" has no property definition`);
      }
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, property] of Object.entries(properties)) {
        const converted = jsonSchemaToZod(property, depth + 1);
        shape[key] = required.includes(key) ? converted : converted.optional();
      }
      return z.object(shape);
    }

    case "array":
      return z.array(jsonSchemaToZod(schema.items ?? {}, depth + 1));

    case "string":
      return z.string();

    case "number":
      return z.number();

    case "integer":
      return z.number().int();

    case "boolean":
      return z.boolean();

    case "null":
      return z.null();

    default:
      throw new Error(
        "Schema field has no usable type (expected one of object/array/string/number/integer/boolean/null)",
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
