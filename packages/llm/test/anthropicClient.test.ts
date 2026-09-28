import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { AnthropicClient } from "../src/anthropicClient.js";
import type { AuditEntry } from "../src/types.js";

const schema = z.object({ answer: z.string() });

function startMockServer(
  responder: (reqCount: number) => { status: number; body?: unknown },
): Promise<Server> {
  let count = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      count += 1;
      const { status, body } = responder(count);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body ? JSON.stringify(body) : "{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const toolUseBody = (input: unknown) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [{ type: "tool_use", id: "toolu_1", name: "emit_test", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 20 },
});

const clientFor = (
  server: Server,
  audit: AuditEntry[],
  sleeps: number[] = [],
) =>
  new AnthropicClient({
    apiKey: "test-key",
    model: "claude-sonnet-5",
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    timeoutMs: 500,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    audit: async (e) => {
      audit.push(e);
    },
  });

const params = (user: string) => ({
  system: "You are a test.",
  user,
  schema,
  tag: "test",
  maxRetries: 2,
});

const running: Server[] = [];
afterAll(() => {
  for (const s of running) s.close();
});

describe("AnthropicClient (gate 1.11)", () => {
  it("retries on 429 with exponential backoff and succeeds", async () => {
    const server = await startMockServer((n) =>
      n < 3
        ? { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }
        : { status: 200, body: toolUseBody({ answer: "ok" }) },
    );
    running.push(server);
    const audit: AuditEntry[] = [];
    const sleeps: number[] = [];
    const client = clientFor(server, audit, sleeps);

    const out = await client.generateStructured(params("hello"));
    expect(out).toEqual({ answer: "ok" });
    expect(sleeps).toEqual([500, 1000]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ status: "ok", tag: "test" });
    expect(audit[0]!.payload).toHaveProperty("usage");
  });

  it("repairs invalid structured output once, then succeeds", async () => {
    const server = await startMockServer((n) =>
      n === 1
        ? { status: 200, body: toolUseBody({ answer: 42 }) } // fails zod
        : { status: 200, body: toolUseBody({ answer: "fixed" }) },
    );
    running.push(server);
    const audit: AuditEntry[] = [];
    const client = clientFor(server, audit);

    const out = await client.generateStructured(params("hello"));
    expect(out).toEqual({ answer: "fixed" });
    expect(audit[0]!.payload).toMatchObject({ status: "ok", repairUsed: true });
  });

  it("throws LLMValidationError when repair also fails, writing an error audit row", async () => {
    const server = await startMockServer(() => ({
      status: 200,
      body: toolUseBody({ wrong: true }),
    }));
    running.push(server);
    const audit: AuditEntry[] = [];
    const client = clientFor(server, audit);

    await expect(client.generateStructured(params("hello"))).rejects.toThrow(
      /failed schema validation/,
    );
    expect(audit[0]!.payload).toMatchObject({ status: "error" });
  });

  it("gives up after timeouts instead of hanging forever", async () => {
    const server = createServer((_req, res) => {
      // Never respond: the client must time out.
      res.socket?.on("close", () => {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    running.push(server);
    const audit: AuditEntry[] = [];
    const sleeps: number[] = [];
    const client = clientFor(server, audit, sleeps);

    await expect(client.generateStructured(params("hello"))).rejects.toThrow();
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.payload).toMatchObject({ status: "error" });
  }, 15000);
});
