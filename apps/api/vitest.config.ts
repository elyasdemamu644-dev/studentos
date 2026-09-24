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
testEnv.DATABASE_URL = testEnv.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/studentos_test';

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