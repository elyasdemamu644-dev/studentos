import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load `.env` into process.env. Existing variables (e.g. those injected by
// vitest) are never overwritten, so this is safe to run in every environment.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  // Missing .env is fine — the process may be environment-driven.
}

// Centralized environment configuration.
// All required env vars are read once at startup and validated so the app
// fails fast with a clear message rather than crashing deep in a route.

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  isTest: nodeEnv === "test",

  // Server
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",

  // Database — must be set (Prisma connection string)
  databaseUrl: process.env.DATABASE_URL,
  databaseUrlWorkers: process.env.DATABASE_URL,

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpiresInSeconds: Number(process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? 900), // 15 min default
  jwtRefreshExpiresInSeconds: Number(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? 604800), // 7 days default
  cookieDomain: process.env.COOKIE_DOMAIN ?? undefined, // web cookie scope
  auth: {
    // Signature algorithm used for access/refresh JWTs.
    algorithm: "HS256",
  },

  // AI provider
  aiEnabled: process.env.AI_ENABLED !== "false",
  aiProvider: process.env.AI_PROVIDER ?? "openai",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? undefined, // for compatible endpoints
  geminiApiKey: process.env.GEMINI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  customAiEndpoint: process.env.CUSTOM_AI_ENDPOINT,
  customAiApiKey: process.env.CUSTOM_AI_API_KEY,

  // S3-compatible storage
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3Bucket: process.env.S3_BUCKET ?? "studentos",
  s3UsePathStyle: process.env.S3_USE_PATH_STYLE === "true",

  // CORS — origins allowed to hit the API (web app + mobile)
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Rate limiting (per-IP, token-bucket style)
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100),
  rateLimitWindowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),

  // Upload limits
  uploadMaxFileSizeBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 50 * 1024 * 1024), // 50 MB default
  uploadAllowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME_TYPES ?? "application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),

  // App metadata
  appName: "StudentOS",
  appVersion: process.env.npm_package_version ?? "1.0.0",
} as const;

// Validate required settings on boot.
export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret) missing.push("JWT_SECRET");
  if (config.aiEnabled && config.aiProvider === "openai" && !config.openAiApiKey) missing.push("OPENAI_API_KEY");
  if (config.s3Endpoint && (!config.s3AccessKeyId || !config.s3SecretAccessKey))
    missing.push("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
}

// Resolve a nice import path for diagnostics ( ESMCompat helper ).
export function resolveTsPath(relativePath: string): string {
  return path.resolve(__dirname, relativePath);
}
