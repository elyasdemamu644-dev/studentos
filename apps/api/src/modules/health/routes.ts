import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { config } from "@/config";

/**
 * Health check endpoint — no auth, always available.
 *
 * Returns service metadata and the database connection status.
 * Used by uptime monitors and load balancer health checks.
 *
 * Deliberately NOT rate limited — see app.ts, where the limiter is mounted
 * on `/api/v1` only so orchestrators can still probe a throttled service.
 */
export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let database: "connected" | "disconnected" = "disconnected";
  let status: "ok" | "degraded" = "degraded";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "connected";
    status = "ok";
  } catch {
    // Keep `degraded` — the process is alive but the DB is unreachable.
  }

  return res.status(status === "ok" ? 200 : 503).json({
    success: status === "ok",
    data: {
      status,
      service: `${config.appName} API`,
      version: config.appVersion,
      environment: config.nodeEnv,
      database,
      timestamp: new Date().toISOString(),
    },
  });
});

export default healthRouter;