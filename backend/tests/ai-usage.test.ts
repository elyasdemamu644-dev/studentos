import { describe, expect, it, vi } from "vitest";
import { AiUsageLimiter } from "@/middlewares/ai-usage";

describe("AiUsageLimiter", () => {
  it("applies per-user minute and daily limits independently", () => {
    let now = Date.UTC(2026, 9, 13, 12);
    const limiter = new AiUsageLimiter(2, 3, () => now);

    expect(limiter.consume("alice")).toBe(true);
    expect(limiter.consume("alice")).toBe(true);
    expect(limiter.consume("alice")).toBe(false);
    expect(limiter.consume("bob")).toBe(true);

    now += 60_000;
    expect(limiter.consume("alice")).toBe(true);
    expect(limiter.consume("alice")).toBe(false);

    now += 86_400_000;
    expect(limiter.consume("alice")).toBe(true);
  });
});
