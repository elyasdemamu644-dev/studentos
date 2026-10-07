import { app } from "@/app";
import { config, validateConfig } from "@/config";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDevelopment ? ["query", "error", "warn"] : ["error"],
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });

if (config.isDevelopment) globalForPrisma.prisma = prisma;

// Validate config and connect to database
validateConfig();

prisma.$connect().then(() => {
  console.log("Database connected");
}).catch((error) => {
  console.error("Database connection failed:", error);
  process.exit(1);
});

export default app;
