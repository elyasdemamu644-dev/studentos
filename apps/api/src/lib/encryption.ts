import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  // Hash the key to ensure exactly 32 bytes if it's longer/shorter
  const hashed = createHash("sha256").update(key).digest();
  return hashed;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns base64-encoded ciphertext with prepended IV.
 * The output format is: base64(iv || ciphertext || authTag)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  // Pack: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const packed = Buffer.concat([iv, authTag, Buffer.from(encrypted, "base64")]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext produced by encrypt().
 * Returns the original plaintext string.
 */
export function decrypt(ciphertextBase64: string): string {
  const key = getEncryptionKey();
  const packed = Buffer.from(ciphertextBase64, "base64");

  // An empty plaintext is still a valid AES-256-GCM output: 12-byte IV plus
  // 16-byte auth tag and zero payload (28 bytes total). Credential-free
  // providers (ollama) store `encryptForUser(userId, "")`, so any shorter
  // threshold than `IV + AUTH_TAG` would reject a legitimate ciphertext.
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = "";
  decrypted += decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Per‑user key vault ─────────────────────────────────────────────────────────

const USER_KEYS = new Map<string, Buffer>();

/**
 * Get or create a per-user encryption key.
 * Keys are deterministically derived from the master key + user id,
 * so they survive process restarts without persistent storage.
 */
function getUserKey(userId: string): Buffer {
  let key = USER_KEYS.get(userId);
  if (!key) {
    const master = getEncryptionKey();
    const salt = Buffer.from(`studentos-user-${userId}`, "utf8");
    key = createHash("sha256").update(Buffer.concat([master, salt])).digest();
    USER_KEYS.set(userId, key);
  }
  return key;
}

/**
 * Encrypt a plaintext string for a specific user.
 * Uses a per-user key so that the same plaintext produces different
 * ciphertext for different users — one user cannot decrypt another's data.
 */
export function encryptForUser(userId: string, plaintext: string): string {
  const key = getUserKey(userId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([iv, authTag, Buffer.from(encrypted, "base64")]);
  return packed.toString("base64");
}

/**
 * Decrypt a per-user ciphertext produced by encryptForUser().
 * Returns the original plaintext string.
 */
export function decryptForUser(userId: string, ciphertextBase64: string): string {
  const key = getUserKey(userId);
  const packed = Buffer.from(ciphertextBase64, "base64");

  // See `decrypt` above: an encrypted empty string is 28 bytes (IV + auth tag)
  // and must be accepted so credential-free providers can round-trip.
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = "";
  decrypted += decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Credential hashing (for idempotency key, not for storage) ─────────────────

/**
 * Hash credentials to a stable string for idempotency-key generation.
 * Does NOT return the raw credentials. The hash is one-way.
 */
export async function hashCredentials(creds: string): Promise<string> {
  const input = typeof creds === "string" ? creds : JSON.stringify(creds);
  const key = getEncryptionKey();
  const hash = createHash("sha256").update(Buffer.concat([key, Buffer.from(input, "utf8")])).digest("hex");
  return hash;
}

/**
 * Encrypt credentials obtained via decrypt() (base64-encoded ciphertext).
 * Wraps the base64 string so it can be stored/transmitted safely.
 */
export function encryptCredentials(ciphertextBase64: string): string {
  return Buffer.from(ciphertextBase64, "base64").toString("base64");
}

/**
 * Decrypt credentials that were encrypted via encryptCredentials().
 * Returns the original base64-encoded ciphertext from decrypt().
 */
export function decryptCredentials(encryptedBase64: string): string {
  return Buffer.from(encryptedBase64, "base64").toString("base64");
}
