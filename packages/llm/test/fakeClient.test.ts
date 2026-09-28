import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FakeLLMClient } from "../src/fakeClient.js";

const schema = z.object({ answer: z.string() });

describe("FakeLLMClient", () => {
  it("returns queued fixtures in order and records calls", async () => {
    const fake = new FakeLLMClient();
    fake.fixture("demo", [{ answer: "first" }, { answer: "second" }]);
    const a = await fake.generateStructured({
      system: "s",
      user: "u1",
      schema,
      tag: "demo",
    });
    const b = await fake.generateStructured({
      system: "s",
      user: "u2",
      schema,
      tag: "demo",
    });
    expect(a).toEqual({ answer: "first" });
    expect(b).toEqual({ answer: "second" });
    expect(fake.calls).toHaveLength(2);
    expect(fake.callsFor("demo")).toBe(2);
  });

  it("throws when no fixture is queued for the tag", async () => {
    const fake = new FakeLLMClient();
    await expect(
      fake.generateStructured({ system: "s", user: "u", schema, tag: "unknown" }),
    ).rejects.toThrow(/no fixture queued for tag "unknown"/);
  });

  it("validates fixture output against the schema", async () => {
    const fake = new FakeLLMClient();
    fake.fixture("bad", { wrong: "shape" });
    await expect(
      fake.generateStructured({ system: "s", user: "u", schema, tag: "bad" }),
    ).rejects.toThrow();
  });
});
