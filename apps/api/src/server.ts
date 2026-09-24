import { app } from "@/app";
import { config, validateConfig } from "@/config";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─────────────────────────────────────────────
// Database client (singleton)
// ─────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Single PrismaClient instance shared across the app lifecycle. */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDevelopment
      ? ["query", "error", "warn"]
      : ["error"],
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });

if (config.isDevelopment) globalForPrisma.prisma = prisma;

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
