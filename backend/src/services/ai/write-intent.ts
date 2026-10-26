// ─────────────────────────────────────────────────────────────────────────────
// Write-intent detection
// ─────────────────────────────────────────────────────────────────────────────
//
// A tool-capable model can still narrate a change ("Shall I go ahead and add
// that?") without calling a WRITE tool. Nothing is written and no confirmation
// card is created, so the student is stranded: there is no button to press and
// no honest signal that the change did not happen (gap #33).
//
// This is a deliberately conservative, pure lexical check on the student's own
// message. It never decides whether to write — it only decides whether a turn
// that produced no proposal should say so. Read questions ("how do I add a
// course?", "what did I add yesterday?") must never match.

const WRITE_VERBS = [
  "add",
  "create",
  "delete",
  "remove",
  "update",
  "change",
  "edit",
  "rename",
  "move",
  "complete",
  "mark",
  "schedule",
  "book",
  "save",
  "remind",
  "log",
] as const;

const VERB = `(?:${WRITE_VERBS.join("|")})`;
const SET_PHRASE = `set\\s+(?:up|a|an|my|the|it|them)`;
const ACTION = `(?:${VERB}|${SET_PHRASE})`;
const POLITE = `(?:please|pls|hey|ok|okay|so|and|also|now|just|kindly|quickly|then)`;

// "Add a task", "please create a note", "also mark it complete".
const IMPERATIVE = new RegExp(`^(?:${POLITE}\\s+)*${ACTION}\\b`, "i");
// "Can you add...", "could you please delete...", "would you update...".
const REQUEST = new RegExp(
  `\\b(?:can|could|would|will)\\s+(?:you|u)\\s+(?:${POLITE}\\s+)*${ACTION}\\b`,
  "i",
);
// "I want you to add...", "I need to log...", "I'd like to schedule...".
const WANT_TO = new RegExp(`\\bi\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+)?to\\s+${VERB}\\b`, "i");
// "Let's add...", "lets create...".
const LETS = new RegExp(`\\b(?:let'?s|lets)\\s+(?:${POLITE}\\s+)*${VERB}\\b`, "i");

// A sentence that opens with one of these is a question, not a request, unless
// it also contains a "can you…" style request form.
const INTERROGATIVE_START =
  /^(?:how|what|why|when|where|which|who|whose|is|are|was|were|do|does|did|should|shall|can|could|would|will|may|might)\b/i;

/** A change was already prepared; the notice must never be added. */
export const WRITE_INTENT_NOTICE =
  "I could not prepare that change, so nothing was saved. Tell me the exact details (for example the title and date) and I'll try again, or make the change yourself from the matching page.";

/**
 * True when the student's message asks for a record to be created, changed or
 * removed. Conservative on purpose: questions, past tense ("I added…"), advice
 * ("you should add…") and negations ("please don't delete…") do not match.
 */
export function hasWriteIntent(message: string): boolean {
  for (const raw of message.split(/[.!?;\n]+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;

    const request = REQUEST.test(sentence) || WANT_TO.test(sentence) || LETS.test(sentence);
    // A request form wins over the headline: "Could you add a task?" is a
    // request even though the sentence starts with "could".
    if (INTERROGATIVE_START.test(sentence) && !request) continue;

    const match =
      IMPERATIVE.exec(sentence) ??
      REQUEST.exec(sentence) ??
      WANT_TO.exec(sentence) ??
      LETS.exec(sentence);
    if (!match) continue;

    // "please don't delete…" / "do not remove…" describe what not to do.
    const before = sentence.slice(0, match.index);
    if (/\b(?:don'?t|do\s+not|not|never|no)\b/i.test(before)) continue;

    return true;
  }
  return false;
}

/** Append the honest dead-end notice, without repeating it if it is present. */
export function appendWriteIntentNotice(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return WRITE_INTENT_NOTICE;
  if (trimmed.includes(WRITE_INTENT_NOTICE)) return trimmed;
  return `${trimmed}\n\n${WRITE_INTENT_NOTICE}`;
}
