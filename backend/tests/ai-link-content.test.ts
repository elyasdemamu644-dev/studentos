import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setOutboundTransportForTests } from "@/utils/safe-fetch";
import {
  clearLinkContentCache,
  fetchLinkContent,
  htmlToText,
} from "@/services/ai/link-content";

// A literal public IP host avoids a real DNS lookup in the SSRF guard while
// still exercising the policy path (an IP literal is classified directly).
const PUBLIC = "https://93.184.216.34/article";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("link content retrieval", () => {
  beforeEach(() => clearLinkContentCache());
  afterEach(() => {
    setOutboundTransportForTests(undefined);
    clearLinkContentCache();
    vi.restoreAllMocks();
  });

  it("extracts readable text and the title from an HTML page", async () => {
    setOutboundTransportForTests(async () =>
      htmlResponse(`
        <html>
          <head><title>Photosynthesis &amp; You</title><style>.x{}</style></head>
          <body>
            <nav>menu</nav>
            <h1>Photosynthesis</h1>
            <p>Plants convert light into <b>chemical energy</b>.</p>
            <script>alert("ignore me")</script>
            <ul><li>Chlorophyll</li><li>Stomata</li></ul>
          </body>
        </html>
      `),
    );

    const result = await fetchLinkContent(PUBLIC);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.title).toBe("Photosynthesis & You");
    expect(result.content.text).toContain("Plants convert light into chemical energy.");
    expect(result.content.text).toContain("- Chlorophyll");
    // Script, style and nav content never reaches the model.
    expect(result.content.text).not.toContain("ignore me");
    expect(result.content.text).not.toContain("menu");
  });

  it("follows a bounded redirect, re-validating each hop", async () => {
    const calls: string[] = [];
    setOutboundTransportForTests(async (url) => {
      calls.push(url);
      if (url === PUBLIC) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://93.184.216.34/final" },
        });
      }
      return htmlResponse("<title>Final</title><p>arrived</p>");
    });

    const result = await fetchLinkContent(PUBLIC);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.url).toBe("https://93.184.216.34/final");
    expect(result.content.text).toContain("arrived");
    expect(calls).toHaveLength(2);
  });

  it("refuses a private destination before any request is made", async () => {
    const transport = vi.fn(async () => htmlResponse("<p>should not happen</p>"));
    setOutboundTransportForTests(transport);

    const result = await fetchLinkContent("https://169.254.169.254/latest/meta-data/");

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a redirect that points at a private destination", async () => {
    setOutboundTransportForTests(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/secret" },
      }),
    );

    const result = await fetchLinkContent(PUBLIC);

    expect(result).toEqual({ ok: false, reason: "blocked" });
  });

  it("reports non-HTML responses as unreadable rather than passing them through", async () => {
    setOutboundTransportForTests(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    const result = await fetchLinkContent(PUBLIC);

    expect(result).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("reports an HTTP error status", async () => {
    setOutboundTransportForTests(async () => new Response("nope", { status: 404 }));

    const result = await fetchLinkContent(PUBLIC);

    expect(result).toEqual({ ok: false, reason: "http_error", status: 404 });
  });

  it("caches a successful fetch so a follow-up does not re-download", async () => {
    const transport = vi.fn(async () => htmlResponse("<title>Cached</title><p>body</p>"));
    setOutboundTransportForTests(transport);

    const first = await fetchLinkContent(PUBLIC);
    const second = await fetchLinkContent(PUBLIC);

    expect(first.ok && second.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("caps very large pages and marks the result truncated", async () => {
    setOutboundTransportForTests(async () =>
      htmlResponse(`<title>Big</title><p>${"x".repeat(60_000)}</p>`),
    );

    const result = await fetchLinkContent(PUBLIC);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.truncated).toBe(true);
    expect(result.content.text.length).toBeLessThanOrEqual(40_000);
  });
});

describe("htmlToText", () => {
  it("decodes numeric and named entities", () => {
    expect(htmlToText("<p>5 &lt; 10 &#38; a&nbsp;b &mdash; c</p>")).toBe("5 < 10 & a b — c");
  });
});
