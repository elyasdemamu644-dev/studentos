import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: PrismaClient | undefined;
}

// During test runs we want a single shared client so cleanup/seed
// operations are transactional and fast; in production each process
// gets its own instance.

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    log: ["error"],
  });
} else {
  if (!global.__db__) {
    global.__db__ = new PrismaClient({
      log: ["query", "error"],
    });
  }
  prisma = global.__db__;
}

export { prisma };
