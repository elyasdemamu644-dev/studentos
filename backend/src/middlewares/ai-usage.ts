import type { NextFunction, Request, Response } from "express";
import { config } from "@/config";
import { rateLimitError } from "@/config/errors";
import type { AuthRequest } from "@/routes/auth";

type UsageWindow = { minute: number; minuteCount: number; day: number; dayCount: number };

export class AiUsageLimiter {
  private readonly users = new Map<string, UsageWindow>();
  private lastPruneDay = -1;

  constructor(
    private readonly perMinute: number,
    private readonly perDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(userId: string): boolean {
    const now = this.now();
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    if (this.lastPruneDay !== day) {
      for (const [id, usage] of this.users) {
        if (usage.day < day - 1) this.users.delete(id);
      }
      this.lastPruneDay = day;
    }
    const window = this.users.get(userId) ?? {
      minute,
      minuteCount: 0,
      day,
      dayCount: 0,
    };

    if (window.minute !== minute) {
      window.minute = minute;
      window.minuteCount = 0;
    }
    if (window.day !== day) {
      window.day = day;
      window.dayCount = 0;
    }

    if (window.minuteCount >= this.perMinute || window.dayCount >= this.perDay) {
      this.users.set(userId, window);
      return false;
    }

    window.minuteCount += 1;
    window.dayCount += 1;
    this.users.set(userId, window);
    return true;
  }
}

const limiter = new AiUsageLimiter(config.aiRateLimitPerMinute, config.aiDailyQuota);

/** Limits generated AI turns per authenticated user and logs metadata only. */
export function limitAndLogAiUsage(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authReq = req as AuthRequest;
  const userId = authReq.currentUser?.id;
  if (!userId) {
    next();
    return;
  }
  if (req.method === "POST" && (req.body as { generateReply?: unknown } | undefined)?.generateReply === false) {
    next();
    return;
  }

  if (!limiter.consume(userId)) {
    console.warn(JSON.stringify({
      event: "ai_request_rate_limited",
      userId,
      route: req.path,
      at: new Date().toISOString(),
    }));
    next(rateLimitError("AI usage limit reached. Please try again later."));
    return;
  }

  const startedAt = Date.now();
  res.once("finish", () => {
    console.info(JSON.stringify({
      event: "ai_request",
      userId,
      route: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    }));
  });
  next();
}
