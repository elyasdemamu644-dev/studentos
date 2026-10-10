import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the app's .env into the test worker env so config/services read the
// same values they would in development (JWT_SECRET etc.).
const testEnv: Record<string, string> = {};

try {
  const envPath = path.resolve(__dirname, '.env');
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    testEnv[key] = value;
  }
} catch {
  // Ignore missing .env — defaults below still apply.
}

testEnv.NODE_ENV = 'test';
testEnv.AI_ENABLED = 'false';

// Zero any AI provider keys so they never reach test workers. The app's `.env`
// (.gitignored) may carry a live OPENROUTER_API_KEY etc.; tests must not be able
// to read them or leak them into snapshots/output.
testEnv.OPENAI_API_KEY = '';
testEnv.OPENROUTER_API_KEY = '';
testEnv.GEMINI_API_KEY = '';
testEnv.ANTHROPIC_API_KEY = '';
testEnv.CUSTOM_AI_API_KEY = '';

testEnv.DATABASE_URL = testEnv.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/studentos_test';
testEnv.ENCRYPTION_KEY = testEnv.ENCRYPTION_KEY ?? 'test-encryption-key-for-studentos-tests-only--32bytes!!';

// Force the upload limit tiny so the "oversized file" path can be exercised
// with a couple of KB instead of tens of MB, regardless of any local `.env`.
// Include text/plain so the plain-text acceptance path is deterministic too.
testEnv.UPLOAD_MAX_FILE_SIZE_BYTES = '2048';
testEnv.UPLOAD_ALLOWED_MIME_TYPES = 'application/pdf,image/png,image/jpeg,text/plain';

// Email dispatch is opt-in per environment; tests must always start from the
// unconfigured state (→ 503 EMAIL_NOT_CONFIGURED) no matter what a local .env
// sets, and mouse-trap any SMTP credentials so they never reach test workers.
testEnv.EMAIL_ENABLED = 'false';
testEnv.SMTP_HOST = '';
testEnv.SMTP_PORT = '';
testEnv.SMTP_SECURE = '';
testEnv.SMTP_USER = '';
testEnv.SMTP_PASSWORD = '';
testEnv.SMTP_FROM = '';
testEnv.EMAIL_TIMEOUT_MS = '';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    env: testEnv,
  },
});