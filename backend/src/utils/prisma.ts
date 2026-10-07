import { PrismaClient } from "@prisma/client";

import { config } from "@/config";

// ─────────────────────────────────────────────
// Single canonical PrismaClient singleton
// ─────────────────────────────────────────────
//
// Every consumer — services, routes, test helpers — imports `prisma` from
// `@/utils/prisma`. `server.ts` connects/disconnects this same instance; it does
// not create its own. More than one client means more than one connection pool
// and, in tests, rows written through one client are not always visible to the
// other under isolation settings.

const globalForPrisma = globalThis as unknown as {
  __db__: PrismaClient | undefined;
};

/** The one PrismaClient instance shared across the app lifecycle. */
export const prisma: PrismaClient =
  globalForPrisma.__db__ ??
  new PrismaClient({
    // Query logging only in development; tests and production log errors only.
    log: config.isDevelopment ? ["query", "error", "warn"] : ["error"],
    // The datasource block in schema.prisma reads `env("DATABASE_URL")`, which
    // `config` has already loaded from `.env` — nothing to override here.
  });

// Cache outside production so `tsx watch` / vitest worker reloads reuse the
// instance instead of opening a new pool on every module evaluation.
if (!config.isProduction) {
  globalForPrisma.__db__ = prisma;
}
