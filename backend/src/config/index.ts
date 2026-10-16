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
const egressAllowedDestinations = (process.env.EGRESS_ALLOWED_DESTINATIONS ?? "")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
const egressAllowedHosts = [...new Set(egressAllowedDestinations.map((entry) => entry.slice(0, entry.lastIndexOf(":"))))];
const trustProxyRaw = (process.env.TRUST_PROXY ?? "").trim();
const corsOriginsRaw = (process.env.CORS_ORIGINS ?? "").trim();
const renderWebHost = (process.env.RENDER_WEB_HOST ?? "").trim();
const corsOriginsValue = corsOriginsRaw || (renderWebHost ? `https://${renderWebHost}` : "http://localhost:3000");

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
    const raw = trustProxyRaw;
    if (raw === "true") return 1;
    if (!raw || raw === "false") return 0;
    const hops = Number(raw);
    return Number.isFinite(hops) && hops >= 0 ? Math.floor(hops) : 0;
  })(),
  trustProxyExplicit: Boolean(trustProxyRaw),
  trustProxyValid: !trustProxyRaw || trustProxyRaw === "true" || trustProxyRaw === "false" || /^\d+$/.test(trustProxyRaw),

  // Database — must be set (Prisma connection string)
  databaseUrl: process.env.DATABASE_URL,

  // Production egress is a separately deployed HTTP CONNECT gateway. The API
  // container has no direct Internet route; the host firewall allows it to
  // reach only that gateway. Destination approvals are operator-owned.
  // Render's direct mode keeps the AI adapter's pinned DNS and destination
  // allowlist checks, but cannot provide host-level network egress isolation.
  egressMode: (process.env.EGRESS_MODE ?? "proxy").trim(),
  egressProxyUrl: process.env.EGRESS_PROXY_URL,
  egressAllowedDestinations,
  egressAllowedHosts,
  egressDatabaseHost: process.env.EGRESS_DATABASE_HOST?.trim().toLowerCase(),

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpiresInSeconds: Number(process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? 900), // 15 min default
  jwtRefreshExpiresInSeconds: Number(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? 604800), // 7 days default
  cookieDomain: process.env.COOKIE_DOMAIN ?? undefined, // web cookie scope
  auth: {
    // Signature algorithm used for access/refresh JWTs.
    algorithm: "HS256",
  },

  // Google OAuth (optional) — enables POST /auth/google. No client secret or
  // access token is ever stored: Google ID tokens are public-key verified
  // against the configured JWKS endpoint, so only the client id is needed.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? undefined,
  googleJwksUri: process.env.GOOGLE_JWKS_URI ?? undefined,

  // AI provider
  aiEnabled: process.env.AI_ENABLED !== "false",
  aiProvider: process.env.AI_PROVIDER ?? "openrouter",
  // Leave provider defaults to the adapter when AI_MODEL is unset. The
  // OpenRouter adapter defaults to its free-model router; other providers
  // retain their own native model defaults.
  aiModel: process.env.AI_MODEL?.trim() || undefined,
  // Base URL for the environment-default provider (default/fallback used when a
  // user has no active personal AI connection). Dev default: OpenRouter.
  aiBaseUrl: process.env.AI_BASE_URL?.trim() || undefined,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined, // for compatible endpoints
  geminiApiKey: process.env.GEMINI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  customAiEndpoint: process.env.CUSTOM_AI_ENDPOINT?.trim() || undefined,
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

    // Hard ceiling on a single provider request. A slow or hung provider must
    // not pin a request (and its socket) open indefinitely; this mirrors the
    // EMAIL_TIMEOUT_MS convention used for SMTP.
    aiRequestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 60_000),
    aiRateLimitPerMinute: Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? 10),
    aiDailyQuota: Number(process.env.AI_DAILY_QUOTA ?? 100),

    // SSRF policy for user-configurable provider endpoints. Public/multi-tenant
    // deployments must deny loopback/private/link-local destinations: the value
    // defaults to false in production and true only in dev/test (where a local
    // Ollama is the normal setup). Production always rejects private endpoints.
    aiAllowPrivateEndpoints: (() => {
      const raw = (process.env.AI_ALLOW_PRIVATE_ENDPOINTS ?? "").trim().toLowerCase();
      if (raw === "true") return true;
      if (raw === "false") return false;
      return nodeEnv !== "production";
    })(),

    // Reject provider responses larger than this. A hostile or misconfigured
    // endpoint must not be able to stream unbounded data into memory.
    aiMaxResponseBytes: Number(process.env.AI_MAX_RESPONSE_BYTES ?? 10 * 1024 * 1024),


  // S3-compatible storage
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3Bucket: process.env.S3_BUCKET ?? "studentos",
  s3UsePathStyle: process.env.S3_USE_PATH_STYLE === "true",
  requireRemoteStorage: process.env.REQUIRE_REMOTE_STORAGE === "true",

  // CORS — origins allowed to hit the API (web app + mobile).
  // `corsOriginsExplicit` records whether the operator actually set the
  // variable, so production validation can refuse the localhost default.
  corsOriginsExplicit: Boolean(corsOriginsRaw || renderWebHost),
  corsOrigins: corsOriginsValue
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
  // Root directory for the local-disk storage provider (used when no S3 bucket
  // is configured). Never serve this directory directly — downloads go through
  // the owner-scoped `GET /resources/:id/download` route.
  // Anchored to the working directory, NOT to `__dirname`: this file is
  // bundled into `dist/server.js` (esbuild), where `__dirname` is the dist
  // folder and a relative path would escape the app directory entirely — the
  // upload then fails with 503 STORAGE_ERROR in production. Deployments set
  // UPLOAD_DIR explicitly; the default only serves local dev and tests.
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"),

  // Email dispatch (notification delivery). Opt-in: disabled until
  // EMAIL_ENABLED=true AND SMTP_HOST is set, otherwise dispatch endpoints
  // answer 503 EMAIL_NOT_CONFIGURED. Credentials stay server-side and are the
  // reason dispatch is only to the authenticated user's own mailbox.
  emailEnabled: process.env.EMAIL_ENABLED === "true",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587), // 587 STARTTLS / 465 implicit TLS / 25 relay
  smtpSecure: process.env.SMTP_SECURE === "true", // implicit TLS on connect
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM ?? "no-reply@tutor-walle.local",
  emailTimeoutMs: Number(process.env.EMAIL_TIMEOUT_MS ?? 10_000),

  // App metadata
  appName: "Tutor Walle",
  appVersion: process.env.npm_package_version ?? "0.1.0",
} as const;

// ─────────────────────────────────────────────
// Production configuration quality
// ─────────────────────────────────────────────
//
// Missing variables are caught above; these are the values that *are* present
// but would be unsafe to boot a real deployment with. Kept separate from
// `validateConfig` so both can be unit-tested without touching process.env.

/** Minimum length accepted for JWT_SECRET / ENCRYPTION_KEY in production. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** Secrets that ship in `.env.example` or are common defaults — never valid in production. */
const PLACEHOLDER_SECRETS = new Set([
  "dev-only-secret-change-in-production",
  "change-in-production",
  "changeme",
  "change-me",
  "secret",
  "test-secret",
  "studentos",
  "password",
]);

export interface ProductionConfigInput {
  nodeEnv: string;
  databaseUrl?: string;
  jwtSecret?: string;
  encryptionKey?: string;
  aiAllowPrivateEndpoints?: boolean;
  egressMode?: string;
  egressProxyUrl?: string;
  egressAllowedDestinations?: readonly string[];
  egressDatabaseHost?: string;
  aiEnabled?: boolean;
  aiProvider?: string;
  aiBaseUrl?: string;
  openAiBaseUrl?: string;
  customAiEndpoint?: string;
  ollamaBaseUrl?: string;
  googleJwksUri?: string;
  s3Endpoint?: string;
  requireRemoteStorage?: boolean;
  emailEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  trustProxyExplicit?: boolean;
  trustProxyValid?: boolean;
  trustProxy?: number;
  corsOriginsExplicit?: boolean;
  corsOrigins?: readonly string[];
}

/** Returns one message per production misconfiguration; empty outside production. */
export function productionConfigErrors(input: ProductionConfigInput): string[] {
  if (input.nodeEnv !== "production") return [];

  const errors: string[] = [];

  const checkSecret = (name: string, value: string | undefined): void => {
    // Absence is already reported by validateConfig as a missing variable.
    if (!value) return;
    const normalised = value.trim().toLowerCase();
    if (PLACEHOLDER_SECRETS.has(normalised) || normalised.includes("change-in-production")) {
      errors.push(`${name} is a placeholder value`);
    } else if (value.trim().length < MIN_PRODUCTION_SECRET_LENGTH) {
      errors.push(
        `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
      );
    } else if (!/^[A-Za-z0-9_-]{43}$/.test(value.trim()) || Buffer.from(value.trim(), "base64url").length !== 32) {
      errors.push(`${name} must be a base64url-encoded 32-byte secret`);
    }
  };

  checkSecret("JWT_SECRET", input.jwtSecret);
  checkSecret("ENCRYPTION_KEY", input.encryptionKey);

  // The web app is a separate origin (no proxy exists in next.config), so an
  // unset CORS_ORIGINS silently leaves it on the localhost default and every
  // deployed browser request fails preflight.
  if (!input.corsOriginsExplicit) {
    errors.push("CORS_ORIGINS must be set explicitly in production");
  } else if ((input.corsOrigins ?? []).length === 0) {
    errors.push("CORS_ORIGINS must contain at least one origin");
  } else if ((input.corsOrigins ?? []).some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol !== "https:" || parsed.origin !== origin || origin === "*";
    } catch {
      return true;
    }
  })) {
    errors.push("CORS_ORIGINS must contain only exact HTTPS origins");
  }

  if (input.aiAllowPrivateEndpoints) errors.push("AI_ALLOW_PRIVATE_ENDPOINTS must be false in production");
  const egressMode = input.egressMode ?? "proxy";
  if (!["proxy", "direct"].includes(egressMode)) {
    errors.push("EGRESS_MODE must be either proxy or direct");
  } else if (egressMode === "proxy") {
    if (!input.egressProxyUrl) {
      errors.push("EGRESS_PROXY_URL is required in production");
    } else {
      try {
        const proxy = new URL(input.egressProxyUrl);
        if (!(["http:", "https:"].includes(proxy.protocol) && proxy.hostname && !proxy.username && !proxy.password && proxy.pathname === "/" && !proxy.search && !proxy.hash)) {
          errors.push("EGRESS_PROXY_URL must be an HTTP(S) proxy URL without embedded credentials or a path");
        }
      } catch {
        errors.push("EGRESS_PROXY_URL must be a valid HTTP(S) proxy URL");
      }
    }
  }
  if (egressMode === "direct" && input.emailEnabled) {
    errors.push("EMAIL_ENABLED is not supported with EGRESS_MODE=direct; SMTP requires the egress proxy");
  }

  const destinations = input.egressAllowedDestinations ?? [];
  const validDestination = (entry: string): boolean => {
    const match = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):([0-9]{1,5})$/.exec(entry);
    if (!match || match[1].includes("..")) return false;
    const port = Number(match[2]);
    return port >= 1 && port <= 65535;
  };
  if (destinations.length === 0 || destinations.some((entry) => !validDestination(entry))) {
    errors.push("EGRESS_ALLOWED_DESTINATIONS must contain approved hostname:port entries");
  }
  const approved = new Set(destinations.map((entry) => entry.toLowerCase()));
  const requireApprovedHttps = (name: string, value: string | undefined): void => {
    if (!value) return;
    try {
      const endpoint = new URL(value);
      const port = Number(endpoint.port || 443);
      const key = `${endpoint.hostname.toLowerCase().replace(/\.$/, "")}:${port}`;
      if (endpoint.protocol !== "https:" || !approved.has(key)) {
        errors.push(`${name} must use HTTPS and be present in EGRESS_ALLOWED_DESTINATIONS`);
      }
    } catch {
      errors.push(`${name} must be a valid HTTPS endpoint`);
    }
  };

  if (input.aiEnabled !== false) {
    const defaultAiEndpoint = (() => {
      switch (input.aiProvider) {
        case "openai": return input.openAiBaseUrl ?? "https://api.openai.com";
        case "openrouter": return input.aiBaseUrl ?? "https://openrouter.ai/api/v1";
        case "gemini": return "https://generativelanguage.googleapis.com";
        case "anthropic": return "https://api.anthropic.com";
        case "custom": return input.customAiEndpoint ?? "https://api.openai.com/v1";
        case "ollama": return input.ollamaBaseUrl;
        default: return undefined;
      }
    })();
    if (input.aiProvider === "ollama" && !input.ollamaBaseUrl) {
      errors.push("OLLAMA_BASE_URL must be an explicit HTTPS endpoint in production");
    } else {
      requireApprovedHttps("Default AI endpoint", defaultAiEndpoint);
    }
  }
  requireApprovedHttps("GOOGLE_JWKS_URI", input.googleJwksUri ?? "https://www.googleapis.com/oauth2/v3/certs");
  if (input.s3Endpoint) requireApprovedHttps("S3_ENDPOINT", input.s3Endpoint);
  if (input.requireRemoteStorage && !input.s3Endpoint) {
    errors.push("S3_ENDPOINT is required when REQUIRE_REMOTE_STORAGE is enabled");
  }
  if (input.emailEnabled && input.smtpHost) {
    const smtpDestination = `${input.smtpHost.toLowerCase().replace(/\.$/, "")}:${input.smtpPort ?? 587}`;
    if (!approved.has(smtpDestination)) {
      errors.push("SMTP_HOST:SMTP_PORT must be present in EGRESS_ALLOWED_DESTINATIONS");
    }
    if (!input.smtpSecure) errors.push("SMTP_SECURE must be true in production to require TLS");
  }

  if (!input.egressDatabaseHost) {
    errors.push("EGRESS_DATABASE_HOST is required in production");
  } else {
    try {
      const database = new URL(input.databaseUrl ?? "");
      const sslMode = database.searchParams.get("sslmode");
      if (database.protocol !== "postgresql:" && database.protocol !== "postgres:") {
        errors.push("DATABASE_URL must use PostgreSQL in production");
      }
      if (database.hostname.toLowerCase().replace(/\.$/, "") !== input.egressDatabaseHost.replace(/\.$/, "")) {
        errors.push("DATABASE_URL hostname must match EGRESS_DATABASE_HOST");
      }
      if (!["require", "verify-ca", "verify-full"].includes(sslMode ?? "")) {
        errors.push("DATABASE_URL must require TLS using sslmode=require, verify-ca, or verify-full");
      }
      if (["localhost", "127.0.0.1", "::1"].includes(database.hostname.toLowerCase())) {
        errors.push("DATABASE_URL must not use a local database in production");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid production PostgreSQL URL");
    }
    if (!destinations.includes(`${input.egressDatabaseHost}:5432`)) {
      errors.push("EGRESS_ALLOWED_DESTINATIONS must approve EGRESS_DATABASE_HOST:5432");
    }
  }

  if (!input.trustProxyExplicit || !input.trustProxyValid || !input.trustProxy || input.trustProxy < 1) {
    errors.push("TRUST_PROXY must explicitly set a positive trusted proxy hop count in production");
  }

  return errors;
}

// Validate required settings on boot.
export function validateConfig(): void {
  const missing: string[] = [];

  if (!["development", "test", "production"].includes(config.nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret) missing.push("JWT_SECRET");
  if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");

  // AI provider credentials are optional at boot. The default-provider path
  // returns a controlled 503 when unconfigured, while personal connections
  // remain usable even if the deployment has no shared provider key.

  if (config.s3Endpoint && (!config.s3AccessKeyId || !config.s3SecretAccessKey))
    missing.push("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");

  // EMAIL_ENABLED without a relay is a silent footgun (dispatch would 503 at
  // runtime), so fail the boot instead of pretending email is on.
  if (config.emailEnabled && !config.smtpHost) missing.push("SMTP_HOST");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }

  const unsafe = productionConfigErrors({
    nodeEnv: config.nodeEnv,
    databaseUrl: config.databaseUrl,
    jwtSecret: config.jwtSecret,
    encryptionKey: config.encryptionKey,
    aiAllowPrivateEndpoints: config.aiAllowPrivateEndpoints,
    egressMode: config.egressMode,
    egressProxyUrl: config.egressProxyUrl,
    egressAllowedDestinations: config.egressAllowedDestinations,
    egressDatabaseHost: config.egressDatabaseHost,
    aiEnabled: config.aiEnabled,
    aiProvider: config.aiProvider,
    aiBaseUrl: config.aiBaseUrl,
    openAiBaseUrl: config.openAiBaseUrl,
    customAiEndpoint: config.customAiEndpoint,
    ollamaBaseUrl: config.ollamaBaseUrl,
    googleJwksUri: config.googleJwksUri,
    s3Endpoint: config.s3Endpoint,
    requireRemoteStorage: config.requireRemoteStorage,
    emailEnabled: config.emailEnabled,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    trustProxyExplicit: config.trustProxyExplicit,
    trustProxyValid: config.trustProxyValid,
    trustProxy: config.trustProxy,
    corsOriginsExplicit: config.corsOriginsExplicit,
    corsOrigins: config.corsOrigins,
  });

  if (unsafe.length > 0) {
    throw new Error(`Unsafe production configuration: ${unsafe.join(", ")}.`);
  }
}
