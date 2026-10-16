import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  safeFetch,
  OutboundResponseTooLargeError,
  OutboundNetworkError,
} from "@/utils/safe-fetch";
import { SsrfBlockedError } from "@/utils/ssrf-guard";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface TestServer {
  origin: string;
  port: number;
  requests: IncomingMessage[];
  close: () => Promise<void>;
}

async function startServer(handler: Handler): Promise<TestServer> {
  const requests: IncomingMessage[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function tracked(handler: Handler): Promise<TestServer> {
  const server = await startServer(handler);
  servers.push(server);
  return server;
}

describe("safeFetch — transport behaviour", () => {
  it("returns status, headers and the full body", async () => {
    const server = await tracked((_req, res) => {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    const res = await safeFetch(`${server.origin}/v1`, {}, { policy: { allowPrivate: true } });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("forwards method, body and headers without leaking to other hosts", async () => {
    let seen: { method?: string; auth?: string; body?: string } = {};
    const server = await tracked((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen = {
          method: req.method,
          auth: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        };
        res.end("done");
      });
    });

    const res = await safeFetch(
      `${server.origin}/chat`,
      {
        method: "POST",
        headers: { Authorization: "Bearer gsk_secret", "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      },
      { policy: { allowPrivate: true } },
    );
    expect(await res.text()).toBe("done");
    expect(seen.method).toBe("POST");
    expect(seen.auth).toBe("Bearer gsk_secret");
    expect(seen.body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("rejects a redirect instead of following it", async () => {
    const server = await tracked((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "http://169.254.169.254/latest/meta-data/");
      res.end();
    });

    await expect(
      safeFetch(`${server.origin}/`, {}, { policy: { allowPrivate: true } }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("caps a streamed body that has no Content-Length", async () => {
    const server = await tracked((_req, res) => {
      // Chunked transfer: no Content-Length, so only the streaming guard can
      // stop this.
      const chunk = Buffer.alloc(1024, 0x61);
      for (let i = 0; i < 8; i += 1) res.write(chunk);
      res.end();
    });

    await expect(
      safeFetch(`${server.origin}/big`, {}, { policy: { allowPrivate: true }, maxBytes: 2048 }),
    ).rejects.toBeInstanceOf(OutboundResponseTooLargeError);
  });

  it("rejects a body whose declared Content-Length exceeds the cap", async () => {
    const server = await tracked((_req, res) => {
      res.setHeader("content-length", "10000000");
      res.end("x");
    });

    await expect(
      safeFetch(`${server.origin}/big`, {}, { policy: { allowPrivate: true }, maxBytes: 2048 }),
    ).rejects.toBeInstanceOf(OutboundResponseTooLargeError);
  });

  it("times out against an endpoint that never responds", async () => {
    const server = await tracked(() => {
      // Intentionally never respond.
    });

    await expect(
      safeFetch(`${server.origin}/slow`, {}, { policy: { allowPrivate: true }, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(OutboundNetworkError);
  });

  it("honours an abort signal", async () => {
    const server = await tracked(() => {
      // Never respond.
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const error = await safeFetch(
      `${server.origin}/slow`,
      { signal: controller.signal },
      { policy: { allowPrivate: true } },
    ).catch((e: unknown) => e);
    expect((error as Error).name).toBe("AbortError");
  });
});

describe("safeFetch — connection pinning (DNS rebinding defence)", () => {
  it("connects to the resolved address even when the hostname has no DNS entry", async () => {
    const server = await tracked((_req, res) => res.end("pinned"));

    let calls = 0;
    const res = await safeFetch(
      `http://pinned.test:${server.port}/v1`,
      {},
      {
        policy: {
          allowPrivate: true,
          resolver: async () => {
            calls += 1;
            return ["127.0.0.1"];
          },
        },
      },
    );
    expect(await res.text()).toBe("pinned");
    // Resolved exactly once: the socket dials the returned address, it does not
    // re-resolve the hostname itself.
    expect(calls).toBe(1);
  });

  it("blocks a rebinding host whose answer is a private address", async () => {
    const server = await tracked((_req, res) => res.end("should-not-reach"));

    await expect(
      safeFetch(
        "https://rebind.test/v1",
        {},
        { policy: { allowPrivate: false, resolver: async () => ["127.0.0.1"] } },
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(server.requests).toHaveLength(0);
  });

  it("blocks a host that mixes public and private answers", async () => {
    await expect(
      safeFetch(
        "https://mixed.test/v1",
        {},
        {
          policy: {
            allowPrivate: false,
            resolver: async () => ["104.18.6.12", "169.254.169.254"],
          },
        },
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks plain HTTP for a public endpoint under the strict policy", async () => {
    await expect(
      safeFetch("http://public.test/v1", {}, { policy: { allowPrivate: false } }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("never contacts the endpoint when the policy blocks it", async () => {
    const server = await tracked((_req, res) => res.end("nope"));
    await expect(
      safeFetch(
        `https://metadata.test:${server.port}/`,
        {},
        { policy: { allowPrivate: false, resolver: async () => ["169.254.169.254"] } },
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(server.requests).toHaveLength(0);
  });
});
