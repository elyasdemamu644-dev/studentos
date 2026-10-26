import type { JsonSchemaObject, MissionToolCatalogEntry } from "@/types/api-types";

export type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "stringArray"
  | "jsonArray"
  | "json"
  | "null";

export interface FieldDescriptor {
  name: string;
  schema: JsonSchemaObject;
  kind: FieldKind;
  required: boolean;
  enumValues?: unknown[];
  description?: string;
}

export interface ToolFormState {
  toolName: string;
  description: string;
  dependsOn: string[];
  arguments: Record<string, unknown>;
}

function unwrapNullable(schema: JsonSchemaObject): JsonSchemaObject | null {
  if (!schema.anyOf || schema.anyOf.length === 0) return schema;
  const options = schema.anyOf.filter((o) => !(o.type === "null"));
  if (options.length === 1) return options[0];
  if (options.length > 1) {
    // Prefer object/array over primitives if present for complex cases
    return options[0];
  }
  return schema;
}

function detectKind(schema: JsonSchemaObject): FieldKind {
  if (schema.anyOf && schema.anyOf.some((o) => o.type === "null")) {
    const inner = unwrapNullable(schema);
    if (!inner) return "null";
    const k = detectKind(inner);
    if (k === "stringArray") return "stringArray";
    if (k === "jsonArray") return "jsonArray";
    if (k === "enum") return "enum";
    if (k === "boolean") return "boolean";
    if (k === "number" || k === "integer") return k;
    if (k === "string") return "string";
    return "json";
  }

  if (schema.enum) return "enum";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "integer") return "integer";
  if (schema.type === "number") return "number";
  if (schema.type === "string") return "string";
  if (schema.type === "array") {
    const items = schema.items ?? {};
    if (items.type === "string" && !items.anyOf && !items.enum) return "stringArray";
    return "jsonArray";
  }
  if (schema.type === "object") return "json";
  return "json";
}

export function getFieldDescriptors(tool: MissionToolCatalogEntry | undefined): FieldDescriptor[] {
  if (!tool) return [];
  const params = tool.parameters ?? {};
  const props = params.properties ?? {};
  const required = new Set(params.required ?? []);
  const entries = Object.entries(props);
  return entries.map(([name, schema]) => {
    const s = schema;
    const unwrapped = s.anyOf && s.anyOf.some((o) => o.type === "null") ? (unwrapNullable(s) ?? s) : s;
    const kind = detectKind(s);
    const enumValues = kind === "enum" ? (unwrapped.enum ?? s.enum) : undefined;
    return {
      name,
      schema: s,
      kind,
      required: required.has(name),
      enumValues,
      description: s.description,
    };
  });
}

export function isNullable(schema: JsonSchemaObject): boolean {
  return Boolean(schema.anyOf?.some((o) => o.type === "null"));
}

export function defaultForField(field: FieldDescriptor): unknown {
  if (field.schema.default !== undefined) return field.schema.default;
  if (isNullable(field.schema) && !field.required) return null;
  if (field.kind === "boolean") return false;
  if (field.kind === "number" || field.kind === "integer") return "";
  if (field.kind === "string") return "";
  if (field.kind === "stringArray") return "";
  if (field.kind === "enum") {
    if (field.enumValues && field.enumValues.length > 0) return field.enumValues[0];
    return "";
  }
  if (field.kind === "jsonArray" || field.kind === "json") return "";
  return "";
}

function humanizeLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function enumLabel(value: unknown): string {
  if (typeof value === "string") return humanizeLabel(value);
  return String(value);
}

export function coerceArguments(descriptors: FieldDescriptor[], args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of descriptors) {
    const raw = args[field.name];
    if (raw === undefined || raw === null) {
      if (raw === null && isNullable(field.schema)) {
        out[field.name] = null;
      }
      continue;
    }
    if (field.kind === "boolean") {
      out[field.name] = Boolean(raw);
      continue;
    }
    if (field.kind === "number") {
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isNaN(n)) continue;
      out[field.name] = n;
      continue;
    }
    if (field.kind === "integer") {
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isNaN(n)) continue;
      out[field.name] = Math.trunc(n);
      continue;
    }
    if (field.kind === "stringArray") {
      if (typeof raw === "string") {
        const arr = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (arr.length === 0) continue;
        out[field.name] = arr;
        continue;
      }
      if (Array.isArray(raw)) {
        const arr = raw.filter((v) => typeof v === "string" && v.trim().length > 0);
        if (arr.length === 0) continue;
        out[field.name] = arr;
        continue;
      }
      continue;
    }
    if (field.kind === "jsonArray" || field.kind === "json") {
      if (typeof raw === "string") {
        if (raw.trim() === "") continue;
        try {
          out[field.name] = JSON.parse(raw);
        } catch {
          // skip invalid JSON; validation will be caught by tool schema
        }
        continue;
      }
      out[field.name] = raw;
      continue;
    }
    if (field.kind === "enum") {
      if (raw === "") continue;
      out[field.name] = raw;
      continue;
    }
    if (field.kind === "string") {
      if (raw === "") continue;
      out[field.name] = raw;
      continue;
    }
    out[field.name] = raw;
  }
  return out;
}
