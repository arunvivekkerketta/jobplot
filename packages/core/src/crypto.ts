import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for sensitive fields at rest (invariant I7).
 * Output format: v1.<iv>.<tag>.<ciphertext>, all base64url.
 * A random 12-byte IV is generated for every call.
 */

const KEY_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class DecryptionError extends Error {
  readonly code = "DECRYPTION_FAILED";

  constructor(message = "Decryption failed: tampered ciphertext or wrong key") {
    super(message);
    this.name = "DecryptionError";
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (32-byte key, base64); got ${key.length}`,
    );
  }
  cachedKey = key;
  return key;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function parseCipher(cipher: string): { iv: Buffer; tag: Buffer; data: Buffer } {
  const parts = cipher.split(".");
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
    throw new DecryptionError("Malformed ciphertext envelope");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const data = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new DecryptionError("Malformed ciphertext envelope");
  }
  return { iv, tag, data };
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [KEY_VERSION, b64url(iv), b64url(tag), b64url(data)].join(".");
}

export function decrypt(cipher: string): string {
  const { iv, tag, data } = parseCipher(cipher);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}

/** Test helper: clears the cached key so a new key takes effect. */
export function resetKeyCache(): void {
  cachedKey = null;
}
