import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertSafeOutboundUrl,
  isDisallowedAddress,
  isStructurallyValidEndpoint,
  parseHttpEndpoint,
  redactEndpoint,
  resolveSafeOutboundUrl,
  SsrfBlockedError,
  type AddressResolver,
} from "@/utils/ssrf-guard";
import {
  AiProvider,
  AiProviderError,
  resolveAiProvider,
  setSsrfPolicyForTests,
} from "@/services/ai/provider";

const expectBlocked = (promise: Promise<unknown>) =>
  expect(promise).rejects.toMatchObject({ code: "AI_PROVIDER_ENDPOINT_BLOCKED" });

const resolverReturning =
  (...addresses: string[]): AddressResolver =>
  async () => addresses;

afterEach(() => {
  setSsrfPolicyForTests(undefined);
  vi.unstubAllGlobals();
});

describe("isStructurallyValidEndpoint", () => {
  it("accepts well-formed http(s) endpoints", () => {
    expect(isStructurallyValidEndpoint("https://api.openai.com/v1")).toBe(true);
    expect(isStructurallyValidEndpoint("http://localhost:11434")).toBe(true);
    expect(isStructurallyValidEndpoint("https://owner-provider.example:8443/v1")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "gopher://x", "javascript:alert(1)"]) {
      expect(isStructurallyValidEndpoint(bad)).toBe(false);
    }
  });

  it("rejects embedded credentials", () => {
    expect(isStructurallyValidEndpoint("https://user:pass@example.com")).toBe(false);
    expect(isStructurallyValidEndpoint("https://user@example.com")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isStructurallyValidEndpoint("not a url")).toBe(false);
    expect(isStructurallyValidEndpoint("https://")).toBe(false);
  });

  it("parseHttpEndpoint throws SsrfBlockedError with a safe message", () => {
    try {
      parseHttpEndpoint("https://user:pass@example.com");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfBlockedError);
      expect((error as Error).message).not.toContain("pass");
    }
  });
});

describe("isDisallowedAddress — IPv4", () => {
  const disallowed = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.5",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.10",
    "203.0.113.10",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ];
  for (const ip of disallowed) {
    it(`blocks ${ip}`, () => expect(isDisallowedAddress(ip)).toBe(true));
  }

  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "192.167.0.1", "192.169.0.1"];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => expect(isDisallowedAddress(ip)).toBe(false));
  }
});

describe("isDisallowedAddress — IPv6", () => {
  const disallowed = [
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "2002:7f00:0001::", // 6to4 wrapping 127.0.0.1
    "2002:a9fe:a9fe::", // 6to4 wrapping link-local
    "64:ff9b::7f00:1", // NAT64 wrapping 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 wrapping metadata
  ];
  for (const ip of disallowed) {
    it(`blocks ${ip}`, () => expect(isDisallowedAddress(ip)).toBe(true));
  }

  const allowed = ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => expect(isDisallowedAddress(ip)).toBe(false));
  }

  it("treats unparseable input as disallowed", () => {
    expect(isDisallowedAddress("definitely-not-an-ip")).toBe(true);
  });
});

describe("assertSafeOutboundUrl — literal hosts", () => {
  it("blocks loopback, private, link-local and metadata literals", async () => {
    for (const url of [
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://10.0.0.5",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:8080",
      "http://[::ffff:169.254.169.254]/",
    ]) {
      await expect(assertSafeOutboundUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("normalises obfuscated IPv4 spellings before classification", async () => {
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/"]) {
      await expect(assertSafeOutboundUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("allows an ordinary public literal", async () => {
    const url = await assertSafeOutboundUrl("https://93.184.216.34/v1");
    expect(url.hostname).toBe("93.184.216.34");
  });
});

describe("assertSafeOutboundUrl — DNS resolution", () => {
  it("allows a hostname that resolves only to public addresses", async () => {
    await expect(
      assertSafeOutboundUrl("https://api.openai.com/v1", {
        resolver: resolverReturning("104.18.6.12", "2606:4700::1"),
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it("blocks a hostname resolving to a private address", async () => {
    await expect(
      assertSafeOutboundUrl("https://internal.example", {
        resolver: resolverReturning("10.0.0.5"),
      })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks a hostname with mixed public and private answers (rebinding)", async () => {
    await expect(
      assertSafeOutboundUrl("https://rebind.example", {
        resolver: resolverReturning("104.18.6.12", "169.254.169.254"),
      })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks when DNS resolution fails or returns nothing", async () => {
    await expect(
      assertSafeOutboundUrl("https://dns-fail.example", {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertSafeOutboundUrl("https://empty.example", { resolver: resolverReturning() })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("allowPrivate policy", () => {
  it("permits loopback/private literals only when allowPrivate is set", async () => {
    await expect(
      assertSafeOutboundUrl("http://localhost:11434", { allowPrivate: true })
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeOutboundUrl("http://10.0.0.5:8080", { allowPrivate: true })
    ).resolves.toBeInstanceOf(URL);
  });

  it("still rejects structural problems when allowPrivate is set", async () => {
    await expect(
      assertSafeOutboundUrl("http://user:pass@localhost", { allowPrivate: true })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("resolveSafeOutboundUrl — pinned addresses", () => {
  it("returns the validated addresses for connection pinning", async () => {
    const resolved = await resolveSafeOutboundUrl("https://api.openai.com/v1", {
      resolver: resolverReturning("104.18.6.12", "2606:4700::1"),
    });
    expect(resolved.addresses).toEqual(["104.18.6.12", "2606:4700::1"]);
  });

  it("requires https for public endpoints", async () => {
    await expect(
      resolveSafeOutboundUrl("http://93.184.216.34/v1")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("pins a literal public IP", async () => {
    const resolved = await resolveSafeOutboundUrl("https://93.184.216.34/v1");
    expect(resolved.addresses).toEqual(["93.184.216.34"]);
  });

  it("does not pin when the operator trusts the OS resolver", async () => {
    const resolved = await resolveSafeOutboundUrl("http://localhost:11434", {
      allowPrivate: true,
    });
    expect(resolved.addresses).toEqual([]);
  });
});

describe("redactEndpoint", () => {
  it("keeps scheme and host but drops path/query", () => {
    expect(redactEndpoint("https://api.example.com/v1?token=secret")).toBe("https://api.example.com");
    expect(redactEndpoint("nonsense")).toBe("[invalid endpoint]");
  });
});

describe("provider outbound request enforcement", () => {
  it("blocks a metadata endpoint before any network call is made", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setSsrfPolicyForTests({ allowPrivate: false });

    const provider = new AiProvider(
      resolveAiProvider("custom"),
      { apiKey: "test-key" },
      "http://169.254.169.254"
    );

    await expectBlocked(provider.chat({ messages: [{ role: "user", content: "hello" }] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves private under the strict policy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setSsrfPolicyForTests({ allowPrivate: false, resolver: resolverReturning("10.1.2.3") });

    const provider = new AiProvider(
      resolveAiProvider("custom"),
      { apiKey: "test-key" },
      "https://sneaky.example/v1"
    );

    await expectBlocked(provider.chat({ messages: [{ role: "user", content: "hello" }] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still allows a public endpoint under the strict policy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    setSsrfPolicyForTests({ allowPrivate: false, resolver: resolverReturning("104.18.6.12") });

    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: "test-key" },
      "https://api.openai.com/v1"
    );
    const result = await provider.chat({ messages: [{ role: "user", content: "hello" }] });
    expect(result.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a redirect response instead of following it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: () => null },
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    setSsrfPolicyForTests({ allowPrivate: false, resolver: resolverReturning("104.18.6.12") });

    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: "test-key" },
      "https://api.openai.com/v1"
    );
    const error = await provider
      .chat({ messages: [{ role: "user", content: "hello" }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe("AI_PROVIDER_ENDPOINT_BLOCKED");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });
});
