import { Router } from "express";
import { prisma } from "@/lib/prisma";

/**
 * Health check endpoint — no auth, always available.
 *
 * Returns service metadata and the database connection status.
 * Used by uptime monitors and load balancer health checks.
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
      service: "StudentOS API",
      version: process.env.npm_package_version ?? "0.1.0",
      environment: process.env.NODE_ENV ?? "development",
      database,
      timestamp: new Date().toISOString(),
    },
  });
});

export default healthRouter;