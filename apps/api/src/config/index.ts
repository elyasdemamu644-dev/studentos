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

  // Number of proxies in front of the API (Express `trust proxy` setting).
  // 0 by default: X-Forwarded-For is ignored, so the rate limiter keys on the
  // real socket address. Set TRUST_PROXY=1 behind nginx/ALB/etc., otherwise
  // every user behind one proxy shares a single rate-limit bucket.
  trustProxy: (() => {
    const raw = (process.env.TRUST_PROXY ?? "").trim();
    if (raw === "true") return 1;
    if (!raw || raw === "false") return 0;
    const hops = Number(raw);
    return Number.isFinite(hops) && hops >= 0 ? Math.floor(hops) : 0;
  })(),

  // Database — must be set (Prisma connection string)
  databaseUrl: process.env.DATABASE_URL,

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
  // Base URL for the environment-default provider (default/fallback used when a
  // user has no active personal AI connection). Dev default: OpenRouter.
  aiBaseUrl: process.env.AI_BASE_URL ?? undefined,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? undefined, // for compatible endpoints
  geminiApiKey: process.env.GEMINI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  customAiEndpoint: process.env.CUSTOM_AI_ENDPOINT,
  customAiApiKey: process.env.CUSTOM_AI_API_KEY,
    // Master key for AI Connections credential storage. lib/encryption.ts
    // reads process.env.ENCRYPTION_KEY directly; surfaced here so validateConfig
    // can fail at boot instead of every AI Connections write returning a 500.
    encryptionKey: process.env.ENCRYPTION_KEY,

    // AI agent loop budget. The hard ceilings in `ai/agent.ts` always win — these
    // only let a deployment tighten them, never raise them past the ceiling.
    aiAgentMaxToolRounds: Number(process.env.AI_AGENT_MAX_TOOL_ROUNDS ?? 4),
    aiAgentMaxToolCalls: Number(process.env.AI_AGENT_MAX_TOOL_CALLS ?? 12),
    aiAgentMaxProposedActions: Number(process.env.AI_AGENT_MAX_PROPOSED_ACTIONS ?? 8),


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
  appVersion: process.env.npm_package_version ?? "0.1.0",
} as const;

// Validate required settings on boot.
export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret) missing.push("JWT_SECRET");
  if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");

  // AI default provider: require the credential the configured provider needs.
  // `aiEnabled` gates the whole default-provider path, so an explicitly named
  // provider must have its key present at boot rather than 502ing at runtime.
  if (config.aiEnabled) {
    switch (config.aiProvider) {
      case "openai":
        if (!config.openAiApiKey) missing.push("OPENAI_API_KEY");
        break;
      case "openrouter":
        if (!config.openRouterApiKey) missing.push("OPENROUTER_API_KEY");
        break;
      case "gemini":
        if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");
        break;
      case "anthropic":
        if (!config.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
        break;
      case "custom":
        if (!config.customAiApiKey) missing.push("CUSTOM_AI_API_KEY");
        if (!config.customAiEndpoint) missing.push("CUSTOM_AI_ENDPOINT");
        break;
      case "ollama":
        break; // endpoint-only; OLLAMA_BASE_URL has a sensible default
      default:
        missing.push(`AI_PROVIDER (unknown provider "${config.aiProvider}")`);
    }
  }

  if (config.s3Endpoint && (!config.s3AccessKeyId || !config.s3SecretAccessKey))
    missing.push("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
}

