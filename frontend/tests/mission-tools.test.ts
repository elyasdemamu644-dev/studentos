import { describe, expect, it } from "vitest";

import {
  coerceArguments,
  defaultForField,
  enumLabel,
  getFieldDescriptors,
  isNullable,
} from "@/features/ai/mission-tools";
import type { JsonSchemaObject, MissionToolCatalogEntry } from "@/types/api-types";

function catalogEntry(parameters: JsonSchemaObject): MissionToolCatalogEntry {
  return {
    name: "create_task",
    kind: "WRITE",
    activityLabel: "Creating a task",
    description: "Create one task.",
    confirmation: "required",
    requiresApproval: true,
    parameters,
  };
}

describe("mission tool descriptors", () => {
  it("describes every argument, its kind, required flag and enum values", () => {
    const fields = getFieldDescriptors(
      catalogEntry({
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "The title" },
          courseId: { anyOf: [{ type: "string" }, { type: "null" }] },
          priority: { type: "string", enum: ["LOW", "HIGH"] },
          estimatedMinutes: { type: "integer" },
          dueDate: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          entries: { type: "array", items: { type: "object" } },
          done: { type: "boolean" },
        },
      }),
    );

    const byName = new Map(fields.map((field) => [field.name, field]));
    expect([...byName.keys()]).toEqual([
      "title",
      "courseId",
      "priority",
      "estimatedMinutes",
      "dueDate",
      "tags",
      "entries",
      "done",
    ]);

    expect(byName.get("title")).toMatchObject({
      kind: "string",
      required: true,
      description: "The title",
    });
    // A `[X, null]` schema keeps X's input control and is flagged nullable.
    expect(byName.get("courseId")).toMatchObject({ kind: "string", required: false });
    expect(isNullable(byName.get("courseId")!.schema)).toBe(true);
    expect(isNullable(byName.get("title")!.schema)).toBe(false);

    expect(byName.get("priority")).toMatchObject({ kind: "enum" });
    expect(byName.get("priority")!.enumValues).toEqual(["LOW", "HIGH"]);
    expect(byName.get("estimatedMinutes")!.kind).toBe("integer");
    expect(byName.get("tags")!.kind).toBe("stringArray");
    expect(byName.get("entries")!.kind).toBe("jsonArray");
    expect(byName.get("done")!.kind).toBe("boolean");
  });

  it("unwraps a nullable enum to the enum it wraps", () => {
    const [field] = getFieldDescriptors(
      catalogEntry({
        type: "object",
        properties: {
          priority: {
            anyOf: [{ type: "string", enum: ["LOW", "HIGH"] }, { type: "null" }],
          },
        },
      }),
    );

    expect(field.kind).toBe("enum");
    expect(field.enumValues).toEqual(["LOW", "HIGH"]);
  });

  it("has no fields for a missing tool", () => {
    expect(getFieldDescriptors(undefined)).toEqual([]);
  });
});

describe("default field values", () => {
  it("prefers a schema default, then null for an optional nullable field", () => {
    const [withDefault, optionalNullable, requiredString] = getFieldDescriptors(
      catalogEntry({
        type: "object",
        properties: {
          type: { type: "string", enum: ["ASSIGNMENT", "OTHER"], default: "OTHER" },
          courseId: { anyOf: [{ type: "string" }, { type: "null" }] },
          title: { type: "string" },
        },
        required: ["title"],
      }),
    );

    expect(defaultForField(withDefault)).toBe("OTHER");
    expect(defaultForField(optionalNullable)).toBeNull();
    expect(defaultForField(requiredString)).toBe("");
  });

  it("defaults booleans to false and everything else to an empty input", () => {
    const [flag, count, options] = getFieldDescriptors(
      catalogEntry({
        type: "object",
        properties: {
          flag: { type: "boolean" },
          count: { type: "integer" },
          tags: { type: "array", items: { type: "string" } },
        },
      }),
    );

    expect(defaultForField(flag)).toBe(false);
    expect(defaultForField(count)).toBe("");
    expect(defaultForField(options)).toBe("");
  });
});

describe("enum labels", () => {
  it("humanizes enum values for the picker", () => {
    expect(enumLabel("STUDY_SESSION")).toBe("Study Session");
    expect(enumLabel("LOW")).toBe("Low");
    expect(enumLabel("dueDate")).toBe("Due Date");
    expect(enumLabel(3)).toBe("3");
  });
});

describe("argument coercion", () => {
  const fields = getFieldDescriptors(
    catalogEntry({
      type: "object",
      properties: {
        title: { type: "string" },
        note: { type: "string" },
        minutes: { type: "number" },
        count: { type: "integer" },
        done: { type: "boolean" },
        priority: { type: "string", enum: ["LOW", "HIGH"] },
        taskIds: { type: "array", items: { type: "string" } },
        entries: { type: "array", items: { type: "object" } },
        courseId: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    }),
  );

  it("converts inputs to the types the tool expects", () => {
    const args = coerceArguments(fields, {
      title: "Revision",
      minutes: "12.5",
      count: "12.9",
      done: true,
      priority: "HIGH",
      taskIds: "a, b , , c",
      entries: '[{"date":"2026-01-01"}]',
    });

    expect(args).toEqual({
      title: "Revision",
      minutes: 12.5,
      count: 12,
      done: true,
      priority: "HIGH",
      taskIds: ["a", "b", "c"],
      entries: [{ date: "2026-01-01" }],
    });
  });

  it("keeps a nullable field explicitly null", () => {
    expect(coerceArguments(fields, { courseId: null })).toEqual({ courseId: null });
  });

  it("omits empty inputs instead of sending them", () => {
    expect(
      coerceArguments(fields, {
        title: "",
        note: "",
        minutes: "",
        count: "not a number",
        taskIds: " , ",
        entries: "",
        priority: "",
      }),
    ).toEqual({});
  });

  it("skips invalid JSON rather than sending a string the tool rejects", () => {
    expect(coerceArguments(fields, { entries: "{not json" })).toEqual({});
  });
});
