import type { ZodType } from "zod";

/**
 * Audit sink so packages/llm never depends on packages/db (the app wires
 * packages/db.writeAudit into the client at construction time).
 */
export interface AuditEntry {
  actor: "SYSTEM" | "USER" | "LLM" | "BROWSER";
  action: string;
  entityType: string;
  entityId?: string;
  payload: Record<string, unknown>;
}

export type AuditWriter = (entry: AuditEntry) => Promise<void>;

export interface GenerateStructuredParams<T> {
  /** Stable system prompt for the task. */
  system: string;
  /** User turn content. Untrusted text must already be wrapped via wrapUntrusted. */
  user: string;
  /** zod schema the output must satisfy. */
  schema: ZodType<T>;
  /** Stable task tag used in audit rows and FakeLLMClient fixtures. */
  tag: string;
  /** Retries on 429/5xx/timeout. Default 2. */
  maxRetries?: number;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMClient {
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;
}

export class LLMValidationError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = "LLMValidationError";
  }
}

export class LLMOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMOutputError";
  }
}
