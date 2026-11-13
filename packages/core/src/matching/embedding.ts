/**
 * Deterministic, offline text embedding used for the vector column.
 *
 * The point of the column is similarity search over postings, not semantic
 * brilliance, so a signed feature-hashing bag of words is enough: it is stable
 * across runs and machines, needs no API key, and keeps unit tests offline.
 * `embeddingModel` records which scheme produced a vector, so a future model can
 * coexist with these rows instead of silently mixing spaces.
 */

export const EMBEDDING_DIMS = 384;
export const EMBEDDING_MODEL = "hash-bow-v1";

const STOP_WORDS = new Set([
  "and", "are", "but", "for", "from", "has", "have", "into", "its", "our",
  "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "was", "were", "will", "with", "you", "your", "job", "role", "team",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Signed feature hashing with term frequency, then L2 normalization. */
export function hashEmbedding(text: string, dims: number = EMBEDDING_DIMS): number[] {
  const vector = new Array<number>(dims).fill(0);
  for (const token of tokens(text)) {
    const hash = fnv1a(token);
    const index = hash % dims;
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Math.round((value / magnitude) * 1e6) / 1e6);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.round((dot / (Math.sqrt(normA) * Math.sqrt(normB))) * 1e6) / 1e6;
}

/** pgvector accepts `[a,b,c]`; this keeps the raw-SQL call sites honest. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}