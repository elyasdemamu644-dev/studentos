import { describe, expect, it } from "vitest";
import {
  CHAT_SUGGESTIONS,
  composerState,
  conversationGroupLabel,
  conversationPreview,
  generateConversationTitle,
  groupConversations,
  isGenericTitle,
  MAX_MESSAGE_LENGTH,
  needsAutoTitle,
  parseInline,
  parseMarkdown,
  resolveConversationTitle,
  safeHref,
  shouldSendOnKey,
  stripMarkdown,
  truncate,
} from "@/features/ai/chat-utils";
import type { Conversation } from "@/types/api-types";

/**
 * The chat experience is built on these helpers: a sidebar title, a date group,
 * a readable reply and a composer that sends on Enter. They are pure, so they
 * are pinned directly rather than through a rendered page.
 */

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-1",
    title: "New conversation",
    type: "CHAT",
    createdAt: "2026-09-30T08:00:00.000Z",
    updatedAt: "2026-09-30T08:00:00.000Z",
    preview: null,
    ...overrides,
  };
}

describe("conversation titles", () => {
  it("derives a useful title from the first message", () => {
    // The exam-prep transform turns the flagship example into a topic rather
    // than an instruction.
    expect(generateConversationTitle("Prepare me for my database exam.")).toBe(
      "Database exam preparation",
    );
    expect(generateConversationTitle("How am I doing academically?")).toBe(
      "How am I doing academically",
    );
    expect(generateConversationTitle("What should I study today?")).toBe("What should I study today");
  });

  it("keeps proper nouns capitalised", () => {
    expect(generateConversationTitle("How is my GPA trending?")).toBe("How is my GPA trending");
    expect(generateConversationTitle("Prepare me for my next exam.")).toBe("Next exam preparation");
  });

  it("strips polite filler that carries no topic", () => {
    expect(generateConversationTitle("Hi, can you please explain B-trees for me?")).toBe(
      "Explain B-trees",
    );
    expect(generateConversationTitle("help me with the lab report")).toBe("The lab report");
  });

  it("keeps only the first clause", () => {
    expect(generateConversationTitle("Summarise chapter 4. Also list the key terms.")).toBe(
      "Summarise chapter 4",
    );
  });

  it("truncates on a word boundary", () => {
    const source =
      "Prepare a really thorough and extremely long study plan for every single course I am taking this semester across the whole curriculum";
    const title = generateConversationTitle(source);

    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);

    // The cut lands where the source has a space, so no partial word survives.
    const head = title.slice(0, -1);
    expect(source.startsWith(head)).toBe(true);
    expect(source[head.length]).toBe(" ");
  });

  it("returns nothing for input with no usable words", () => {
    expect(generateConversationTitle("   ")).toBe("");
    expect(generateConversationTitle("?!.")).toBe("");
  });

  it("recognises the generic titles the API seeds", () => {
    expect(isGenericTitle("Chat")).toBe(true);
    expect(isGenericTitle("new conversation")).toBe(true);
    expect(isGenericTitle("Database exam preparation")).toBe(false);
    expect(isGenericTitle(null)).toBe(true);
  });

  it("prefers a derived title, then a real stored title", () => {
    expect(resolveConversationTitle(makeConversation({ title: "Chat" }), "Exam prep")).toBe(
      "Exam prep",
    );
    expect(resolveConversationTitle(makeConversation({ title: "Exam prep" }))).toBe("Exam prep");
    expect(resolveConversationTitle(makeConversation({ title: "Chat" }))).toBe("New conversation");
    expect(resolveConversationTitle(undefined)).toBe("New conversation");
  });

  it("only auto-titles a conversation that has never been titled", () => {
    expect(needsAutoTitle(makeConversation({ title: "Chat" }))).toBe(true);
    expect(needsAutoTitle(makeConversation({ title: "Exam prep" }))).toBe(false);
  });
});

describe("truncate", () => {
  it("leaves short values alone and collapses whitespace", () => {
    expect(truncate("short  value", 40)).toBe("short value");
  });

  it("cuts at a word boundary and appends an ellipsis", () => {
    expect(truncate("alpha beta gamma delta", 16)).toBe("alpha beta…");
  });

  it("does not leave trailing punctuation before the ellipsis", () => {
    expect(truncate("alpha beta, gamma delta", 15)).toBe("alpha beta…");
  });
});

describe("conversation grouping", () => {
  const now = new Date(2026, 8, 30, 12, 0, 0);

  it("buckets by local calendar day", () => {
    expect(conversationGroupLabel(new Date(2026, 8, 30, 9, 0, 0), now)).toBe("Today");
    expect(conversationGroupLabel(new Date(2026, 8, 30, 23, 0, 0), now)).toBe("Today");
    expect(conversationGroupLabel(new Date(2026, 8, 29, 23, 0, 0), now)).toBe("Yesterday");
    expect(conversationGroupLabel(new Date(2026, 8, 24, 12, 0, 0), now)).toBe("Previous 7 days");
    expect(conversationGroupLabel(new Date(2026, 8, 22, 12, 0, 0), now)).toBe("Older");
  });

  it("treats a future timestamp as today rather than a phantom group", () => {
    expect(conversationGroupLabel(new Date(2026, 8, 31, 8, 0, 0), now)).toBe("Today");
  });

  it("treats an unparsable timestamp as older", () => {
    expect(conversationGroupLabel("not-a-date", now)).toBe("Older");
  });

  it("emits only non-empty groups, in order", () => {
    const groups = groupConversations(
      [
        makeConversation({ id: "old", updatedAt: new Date(2026, 7, 1, 9, 0, 0).toISOString() }),
        makeConversation({ id: "today", updatedAt: new Date(2026, 8, 30, 9, 0, 0).toISOString() }),
        makeConversation({ id: "yesterday", updatedAt: new Date(2026, 8, 29, 9, 0, 0).toISOString() }),
      ],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Older"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["today"]);
  });

  it("keeps the caller's order inside a group", () => {
    const groups = groupConversations(
      [
        makeConversation({ id: "newer", updatedAt: new Date(2026, 8, 30, 11, 0, 0).toISOString() }),
        makeConversation({ id: "older", updatedAt: new Date(2026, 8, 30, 8, 0, 0).toISOString() }),
      ],
      now,
    );
    expect(groups[0].items.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("conversation preview", () => {
  it("falls back to a placeholder when there is no message", () => {
    expect(conversationPreview(makeConversation())).toBe("No messages yet");
  });

  it("shows the newest message without markdown noise", () => {
    const conversation = makeConversation({
      preview: { content: "**Grading** is up 4% this term.", role: "ASSISTANT", createdAt: "2026-09-30T08:00:00.000Z" },
    });
    expect(conversationPreview(conversation)).toBe("Grading is up 4% this term.");
  });

  it("truncates a long preview", () => {
    const conversation = makeConversation({
      preview: { content: "word ".repeat(80), role: "ASSISTANT", createdAt: "2026-09-30T08:00:00.000Z" },
    });
    const preview = conversationPreview(conversation);
    expect(preview.length).toBeLessThanOrEqual(81);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("markdown rendering", () => {
  it("splits paragraphs, lists and code fences", () => {
    const blocks = parseMarkdown(
      ["Here is the plan:", "", "- Review notes", "- Run past paper", "", "```sql", "SELECT 1;", "```"].join("\n"),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "bullets",
      "code",
    ]);
    expect(blocks[1]).toEqual({ kind: "bullets", items: ["Review notes", "Run past paper"] });
    expect(blocks[2]).toEqual({ kind: "code", language: "sql", code: "SELECT 1;" });
  });

  it("reads an ordered list", () => {
    const blocks = parseMarkdown("1. Read\n2. Revise");
    expect(blocks).toEqual([{ kind: "numbers", items: ["Read", "Revise"] }]);
  });

  it("reads a heading as a heading, keeping its level", () => {
    expect(parseMarkdown("## Study plan")).toEqual([
      { kind: "heading", level: 2, text: "Study plan" },
    ]);
    expect(parseMarkdown("# Top")).toEqual([{ kind: "heading", level: 1, text: "Top" }]);
  });

  it("groups consecutive blockquote lines", () => {
    expect(parseMarkdown("> first\n> second\n\nafter")).toEqual([
      { kind: "blockquote", lines: ["first", "second"] },
      { kind: "paragraph", lines: ["after"] },
    ]);
  });

  it("parses a pipe table with alignment", () => {
    const blocks = parseMarkdown(
      ["| Course | Credits |", "| :--- | ---: |", "| DB301 | 15 |", "| MA101 | 10 |"].join("\n"),
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        table: {
          headers: ["Course", "Credits"],
          rows: [
            ["DB301", "15"],
            ["MA101", "10"],
          ],
          align: ["left", "right"],
        },
      },
    ]);
  });

  it("does not mistake a horizontal rule for a table", () => {
    expect(parseMarkdown("Notes\n\n---\n\nMore")).toEqual([
      { kind: "paragraph", lines: ["Notes"] },
      { kind: "paragraph", lines: ["---"] },
      { kind: "paragraph", lines: ["More"] },
    ]);
  });

  it("keeps hyphens inside a code fence instead of reading them as bullets", () => {
    const blocks = parseMarkdown("```\n- not a bullet\n- also not\n```");
    expect(blocks).toEqual([{ kind: "code", language: null, code: "- not a bullet\n- also not" }]);
  });

  it("tokenizes bold, italic and inline code", () => {
    expect(parseInline("plain **bold** `code`")).toEqual([
      { kind: "text", value: "plain " },
      { kind: "strong", value: [{ kind: "text", value: "bold" }] },
      { kind: "text", value: " " },
      { kind: "code", value: "code" },
    ]);
    expect(parseInline("_em_")).toEqual([{ kind: "em", value: [{ kind: "text", value: "em" }] }]);
  });

  it("leaves unmatched markers as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", value: "2 * 3 = 6" }]);
  });

  it("tokenizes a link", () => {
    expect(parseInline("see [the notes](https://example.com/notes) now")).toEqual([
      { kind: "text", value: "see " },
      { kind: "link", label: "the notes", href: "https://example.com/notes" },
      { kind: "text", value: " now" },
    ]);
  });

  it("does not treat an image as a link", () => {
    expect(parseInline("![alt](https://example.com/a.png)")).toEqual([
      { kind: "text", value: "![alt](https://example.com/a.png)" },
    ]);
  });

  it("allows only http(s) and mailto link targets", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:tutor@example.edu")).toBe("mailto:tutor@example.edu");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("/relative/path")).toBeNull();
  });

  it("reduces markdown to plain text for previews", () => {
    expect(stripMarkdown("## Grade\n- **Maths**: 90%\n`sum()`")).toBe("Grade Maths: 90% sum()");
  });
});

describe("composer", () => {
  it("sends on Enter but not on Shift+Enter", () => {
    expect(shouldSendOnKey("Enter", false)).toBe(true);
    expect(shouldSendOnKey("Enter", true)).toBe(false);
    expect(shouldSendOnKey("a", false)).toBe(false);
  });

  it("blocks empty, over-limit and in-flight sends", () => {
    expect(composerState("", { busy: false }).canSend).toBe(false);
    expect(composerState("   ", { busy: false }).canSend).toBe(false);
    expect(composerState("hello", { busy: true }).canSend).toBe(false);
    expect(composerState("hello", { busy: false, disabled: true }).canSend).toBe(false);
    expect(composerState("hello", { busy: false }).canSend).toBe(true);
  });

  it("flags an over-limit draft instead of silently truncating it", () => {
    const state = composerState("x".repeat(MAX_MESSAGE_LENGTH + 1), { busy: false });
    expect(state.canSend).toBe(false);
    expect(state.overLimit).toBe(true);
    expect(state.remaining).toBe(-1);
  });
});

describe("empty-state suggestions", () => {
  it("offers prompts that can actually be sent", () => {
    expect(CHAT_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
    for (const suggestion of CHAT_SUGGESTIONS) {
      expect(suggestion.label.length).toBeGreaterThan(0);
      expect(suggestion.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every suggestion a usable derived title", () => {
    for (const suggestion of CHAT_SUGGESTIONS) {
      expect(generateConversationTitle(suggestion.prompt)).not.toBe("");
    }
  });
});
