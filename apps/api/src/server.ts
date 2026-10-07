import { app } from "@/app";
import { config, validateConfig } from "@/config";
import { prisma } from "@/lib/prisma";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─────────────────────────────────────────────
// Database client
// ─────────────────────────────────────────────
//
// The single PrismaClient singleton lives in `@/lib/prisma` and is shared by
// every service, route and test helper. `server.ts` only owns its lifecycle:
// connect on boot, disconnect on shutdown.

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  // Fail fast if required env vars are missing.
  validateConfig();

  // Connect to the database and verify connectivity.
  try {
    await prisma.$connect();
    console.log("Database connected");
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }

  // Start the HTTP server.
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `${config.appName} v${config.appVersion} listening on ${config.host}:${config.port} ` +
        `(env=${config.nodeEnv})`,
    );
  });

  // EADDRINUSE and friends arrive as `error` events; without a listener Node
  // throws them as an unhandled exception, which looks like a crash rather
  // than the port conflict it is.
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`HTTP server failed to start: ${error.code ?? error.name} ${error.message}`);
    process.exit(1);
  });

  // Graceful shutdown — stop accepting new connections, drain existing ones,
  // disconnect Prisma, then exit.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      console.log("HTTP server closed");
      await prisma.$disconnect();
      console.log("Database disconnected");
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long.
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A rejected promise that nothing awaited, or an exception outside the
  // request loop, would otherwise die silently (or take the process down with
  // no log line). Log both with enough context to find them, then stop.
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception, exiting:", error);
    process.exit(1);
  });
}

// Only start the server when this file is executed directly (e.g. `tsx
// watch src/server.ts`), NOT when imported by tests or other modules.
const isMain =
  process.argv[1] != null &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  main().catch((error) => {
    console.error("Fatal startup error:", error);
    process.exit(1);
  });
}
