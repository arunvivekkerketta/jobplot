import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AuditWriter,
  GenerateStructuredParams,
  LLMClient,
  LLMUsage,
} from "./types.js";
import { LLMValidationError } from "./types.js";
import { redactDeep } from "./redact.js";

const DEFAULT_MAX_RETRIES = 2;
const TIMEOUT_MS = 60_000;
const RETRY_BASE_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  audit?: AuditWriter;
  /** Override the API base URL (tests point this at a mock server). */
  baseURL?: string;
  /** Request timeout in ms (default 60_000; tests use a small value). */
  timeoutMs?: number;
  /** Test hook: override sleep for deterministic retry timing. */
  sleepFn?: (ms: number) => Promise<void>;
}

interface ToolCallBlock {
  name: string;
  input: unknown;
}

function extractToolInput(response: Anthropic.Message): unknown {
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const tool = block as unknown as ToolCallBlock;
      return tool.input;
    }
  }
  throw new Error("Model returned no tool_use block");
}

/**
 * Anthropic-backed LLMClient. Forced tool call whose schema comes from zod,
 * 60 s timeout, exponential retry on 429/5xx, one repair retry on zod failure.
 * Writes an AuditLog entry per call with tag, model, token counts and a
 * redacted payload.
 */
export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly audit?: AuditWriter;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(opts: AnthropicClientOptions = {}) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      timeout: opts.timeoutMs ?? TIMEOUT_MS,
      maxRetries: 0, // we own retry semantics
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
    this.model = opts.model ?? process.env.LLM_MODEL ?? "claude-sonnet-5";
    this.audit = opts.audit;
    this.sleepFn = opts.sleepFn ?? sleep;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  private readonly timeoutMs: number;

  private async auditCall(
    tag: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit({
      actor: "LLM",
      action: "llm.call",
      entityType: "LLM",
      entityId: tag,
      payload: redactDeep(payload),
    });
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const { system, user, schema, tag } = params;
    const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
    const jsonSchema = zodToJsonSchema(schema, { target: "openAi" }) as Record<
      string,
      unknown
    >;
    const toolName = `emit_${tag.replace(/[^a-z0-9_]/gi, "_")}`;

    let usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    let repairUsed = false;
    let lastZodError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: user },
      ];
      if (repairUsed) {
        messages.push({
          role: "assistant",
          content: JSON.stringify(lastZodError),
        });
        messages.push({
          role: "user",
          content:
            "Your previous output failed schema validation. The validation errors are shown above. " +
            "Return corrected output that satisfies the schema exactly.",
        });
      }

      try {
        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: 4096,
            system,
            messages,
            tools: [
              {
                name: toolName,
                description: `Return the structured output for task ${tag}`,
                input_schema: jsonSchema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: "tool", name: toolName },
          },
          { timeout: this.timeoutMs },
        );

        usage = {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        };
        const raw = extractToolInput(response);
        const parsed = schema.safeParse(raw);
        if (parsed.success) {
          await this.auditCall(tag, {
            model: this.model,
            tag,
            attempt,
            repairUsed,
            usage,
            status: "ok",
          });
          return parsed.data;
        }
        lastZodError = parsed.error.issues;
        if (!repairUsed) {
          repairUsed = true; // exactly one repair retry
          continue;
        }
        throw new LLMValidationError(
          `LLM output failed schema validation after repair for task ${tag}`,
          lastZodError,
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        const name = err instanceof Error ? err.name : "";
        const message = err instanceof Error ? err.message : "";
        const retryable =
          status === 429 ||
          (status !== undefined && status >= 500) ||
          name === "APIConnectionTimeoutError" ||
          name === "APIConnectionError" ||
          name === "AbortError" ||
          /timed?\s*out|aborted|econn|socket hang up|fetch failed/i.test(message);
        if (retryable && attempt < maxRetries) {
          await this.sleepFn(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        await this.auditCall(tag, {
          model: this.model,
          tag,
          attempt,
          repairUsed,
          usage,
          status: "error",
          error: String(err),
        });
        throw err;
      }
    }

    throw new LLMValidationError(
      `LLM output failed schema validation for task ${tag}`,
      lastZodError,
    );
  }
}
