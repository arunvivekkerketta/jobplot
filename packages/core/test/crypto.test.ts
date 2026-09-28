import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encrypt, decrypt, DecryptionError, resetKeyCache } from "../src/crypto.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = KEY;
  resetKeyCache();
});

afterAll(() => {
  delete process.env.APP_ENCRYPTION_KEY;
  resetKeyCache();
});

describe("crypto (gate 1.5)", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const plain = "Expected CTC: ₹24,00,000 — do not log";
    const cipher = encrypt(plain);
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(decrypt(cipher)).toBe(plain);
  });

  it("produces a fresh IV per call so identical plaintexts differ", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("throws DecryptionError on tampered ciphertext", () => {
    const cipher = encrypt("sensitive");
    const parts = cipher.split(".");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow(DecryptionError);
  });

  it("throws DecryptionError when decrypted with the wrong key", () => {
    const cipher = encrypt("sensitive");
    process.env.APP_ENCRYPTION_KEY = OTHER_KEY;
    resetKeyCache();
    expect(() => decrypt(cipher)).toThrow(DecryptionError);
    process.env.APP_ENCRYPTION_KEY = KEY;
    resetKeyCache();
    expect(decrypt(cipher)).toBe("sensitive");
  });
});
