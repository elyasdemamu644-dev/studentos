// ─────────────────────────────────────────────────────────────────────────────
// Link content retrieval for AI attachments
// ─────────────────────────────────────────────────────────────────────────────
//
// A student can attach a web link (a saved `Resource` whose `storageType` is not
// `UPLOAD`). Without this module the AI only ever learned that a link existed —
// it could not read the page. This module retrieves the page text so the model
// can actually answer questions about it.
//
// Design rules, all deliberate:
//
//  * Every request goes through `utils/safe-fetch.ts`, which resolves and pins
//    the connection to SSRF-validated addresses. User links are dialed with a
//    strict policy (`allowPrivate:false`) regardless of the operator's
//    provider setting: a link a student pastes must never reach loopback, a LAN
//    host or the cloud metadata service. In production the same mandatory egress
//    policy (proxy allowlist / HTTPS) still applies on top.
//  * Redirects are followed manually and bounded: each hop's target is
//    re-validated before it is dialed, so a public URL cannot bounce the fetch
//    onto a private one.
//  * Only text-ish responses are read (HTML, XHTML, plain text); anything else
//    is reported as unreadable rather than being handed to the model as noise.
//  * The extracted text is capped and de-tagged, and callers frame it as
//    untrusted reference material — page content is never treated as
//    instructions.
//  * Successful fetches are cached briefly so a follow-up turn does not
//    re-download the same page.

import { assertSafeOutboundUrl, SsrfBlockedError, type SsrfPolicy } from "@/utils/ssrf-guard";
import {
  outboundFetch,
  OutboundNetworkError,
  OutboundResponseTooLargeError,
} from "@/utils/safe-fetch";

/** Byte ceiling on a single fetched page. */
const MAX_LINK_BYTES = 2 * 1024 * 1024;
/** Overall ceiling on extracted page text handed to the model. */
const MAX_LINK_CHARS = 40_000;
/** Total wall-clock budget for one retrieval, across all redirect hops. */
const LINK_TIMEOUT_MS = 15_000;
/** Maximum redirect hops before giving up. */
const MAX_REDIRECTS = 3;

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

/** Why a link could not be read. Kept coarse so the note the model sees is stable. */
export type LinkFetchFailure =
  | "blocked"
  | "network"
  | "redirect"
  | "http_error"
  | "too_large"
  | "unsupported_type"
  | "empty";

export interface LinkContent {
  /** The URL actually read (after redirects). */
  url: string;
  title: string | null;
  text: string;
  contentType: string;
  truncated: boolean;
}

export type LinkFetchResult =
  | { ok: true; content: LinkContent }
  | { ok: false; reason: LinkFetchFailure; status?: number };

/**
 * The SSRF policy for user-supplied links. Always strict: private/loopback
 * destinations are refused even when the deployment allows them for a
 * self-hosted AI provider.
 */
const LINK_SSRF_POLICY: SsrfPolicy = { allowPrivate: false };

interface CacheEntry {
  expiresAt: number;
  result: LinkFetchResult;
}

const cache = new Map<string, CacheEntry>();

/** Clear the in-process cache. Exposed for tests. */
export function clearLinkContentCache(): void {
  cache.clear();
}

export async function fetchLinkContent(
  rawUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<LinkFetchResult> {
  const cached = cache.get(rawUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = await retrieveLinkContent(rawUrl, options.signal);

  if (result.ok) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(rawUrl, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  }
  return result;
}

async function retrieveLinkContent(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<LinkFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  const onExternalAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    // Validate the very first URL up front so an unsafe literal (for example a
    // metadata IP) is refused before any transport runs, even under a test
    // transport override.
    let current: string;
    try {
      current = (await assertSafeOutboundUrl(rawUrl, LINK_SSRF_POLICY)).href;
    } catch (error) {
      if (error instanceof SsrfBlockedError) return { ok: false, reason: "blocked" };
      throw error;
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await outboundFetch(
        current,
        {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
            "user-agent": "TutorWalleBot/1.0 (+https://tutor-walle.app)",
          },
          signal: controller.signal,
          redirect: "manual",
        },
        {
          policy: LINK_SSRF_POLICY,
          maxBytes: MAX_LINK_BYTES,
          timeoutMs: LINK_TIMEOUT_MS,
          allowRedirectResponse: true,
        },
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) return { ok: false, reason: "redirect" };
        if (hop === MAX_REDIRECTS) return { ok: false, reason: "redirect" };

        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return { ok: false, reason: "redirect" };
        }
        // Re-validate every hop against the same strict policy: a valid public
        // URL must not be able to bounce the fetch onto a private destination.
        try {
          current = (await assertSafeOutboundUrl(next, LINK_SSRF_POLICY)).href;
        } catch (error) {
          if (error instanceof SsrfBlockedError) return { ok: false, reason: "blocked" };
          throw error;
        }
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: "http_error", status: response.status };
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const raw = await response.text();
      const trimmed = raw.trim();
      if (!trimmed) return { ok: false, reason: "empty" };

      if (isHtml(contentType)) {
        const title = extractTitle(raw);
        const text = capText(htmlToText(raw));
        if (!text) return { ok: false, reason: "empty" };
        return {
          ok: true,
          content: {
            url: current,
            title,
            text: text.value,
            contentType,
            truncated: text.truncated,
          },
        };
      }

      if (isTextual(contentType)) {
        const text = capText(trimmed);
        return {
          ok: true,
          content: {
            url: current,
            title: null,
            text: text.value,
            contentType,
            truncated: text.truncated,
          },
        };
      }

      return { ok: false, reason: "unsupported_type" };
    }

    return { ok: false, reason: "redirect" };
  } catch (error) {
    if (error instanceof OutboundResponseTooLargeError) return { ok: false, reason: "too_large" };
    if (error instanceof SsrfBlockedError) return { ok: false, reason: "blocked" };
    if (error instanceof OutboundNetworkError) return { ok: false, reason: "network" };
    if (error instanceof Error && error.name === "AbortError") return { ok: false, reason: "network" };
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

function isHtml(contentType: string): boolean {
  return /\b(?:text\/html|application\/xhtml\+xml)\b/.test(contentType);
}

function isTextual(contentType: string): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("text/") ||
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("+json") ||
    contentType.includes("+xml")
  );
}

function capText(text: string): { value: string; truncated: boolean } {
  if (text.length <= MAX_LINK_CHARS) return { value: text, truncated: false };
  return { value: text.slice(0, MAX_LINK_CHARS), truncated: true };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  middot: "·",
  bull: "•",
};

/** Decode the small set of character references that matter for prose. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    const named = NAMED_ENTITIES[code.toLowerCase()];
    if (named !== undefined) return named;
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const value = Number.parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(value) && value >= 0 && value <= 0x10ffff) {
        try {
          return String.fromCodePoint(value);
        } catch {
          return match;
        }
      }
    }
    return match;
  });
}

/** Pull the document title, if the page declares one. */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = decodeEntities(match[1].replace(/\s+/g, " ")).trim();
  return title || null;
}

/**
 * A deliberately small HTML-to-text pass. It removes non-content elements,
 * turns block boundaries into newlines, strips the remaining tags and decodes
 * the common entities. It is not a full parser — the goal is readable prose for
 * the model, not a faithful DOM.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|head|nav|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|header|footer|main|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dd|dt)>/gi, "\n")
    // Inline formatting tags are removed without inserting a space, so words
    // split by markup ("energy</b>.") stay glued together.
    .replace(/<\/?(?:b|strong|i|em|u|s|del|ins|span|a|code|kbd|samp|var|small|sub|sup|mark|abbr|cite|time|bdi|bdo|ruby|rt|rp|wbr|font|label|big)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
