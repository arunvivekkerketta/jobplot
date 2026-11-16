import { describe, expect, it } from "vitest";
import { playwrightPage, type LocatorLike, type PageLike } from "../src/playwrightPage.js";
import type { RawControl } from "../src/runner.js";

function control(overrides: Partial<RawControl> = {}): RawControl {
  return {
    index: 0,
    label: "",
    name: "field",
    id: "field",
    autocomplete: "",
    type: "text",
    ...overrides,
  };
}

function fakePage(): { page: PageLike; calls: string[] } {
  const calls: string[] = [];
  const locator = (selector: string): LocatorLike => ({
    async fill(value: string) {
      calls.push(`fill:${selector}=${value}`);
    },
    async check() {
      calls.push(`check:${selector}`);
    },
    async uncheck() {
      calls.push(`uncheck:${selector}`);
    },
    async selectOption(option: { label: string } | string) {
      calls.push(`select:${selector}=${typeof option === "string" ? option : option.label}`);
      return [];
    },
    async setInputFiles(path: string) {
      calls.push(`attach:${selector}=${path}`);
    },
    async click() {
      calls.push(`click:${selector}`);
    },
    async innerText() {
      return "";
    },
    nth(index: number) {
      return locator(`${selector}:nth(${index})`);
    },
  });

  const page: PageLike = {
    async goto() {
      return null;
    },
    locator,
    evaluate: (async () => []) as PageLike["evaluate"],
  };
  return { page, calls };
}

describe("gate 2.2a: an answer is never turned into the wrong checkbox (M3)", () => {
  it("unchecks a consent box answered No and never checks it", async () => {
    const { page, calls } = fakePage();
    await playwrightPage(page).fill(control({ type: "checkbox", label: "I agree" }), "No");
    expect(calls).toEqual(['uncheck:[id="field"]']);
  });

  it("checks the box answered Yes", async () => {
    const { page, calls } = fakePage();
    await playwrightPage(page).fill(control({ type: "checkbox" }), " Yes ");
    expect(calls).toEqual(['check:[id="field"]']);
  });

  it("refuses an answer it cannot map", async () => {
    const { page } = fakePage();
    await expect(
      playwrightPage(page).fill(control({ type: "checkbox" }), "maybe"),
    ).rejects.toThrow("Cannot map answer to a checkbox");
  });

  it("selects only the radio whose own label matches", async () => {
    const { page, calls } = fakePage();
    const runtime = playwrightPage(page);
    await runtime.fill(control({ type: "radio", label: "No" }), "yes");
    expect(calls).toEqual([]);
    await runtime.fill(control({ type: "radio", label: "Yes" }), "yes");
    expect(calls).toEqual(['check:[id="field"]']);
  });
});

describe("gate 2.2b: selects and generated ids (M3)", () => {
  it("selects an option by its label", async () => {
    const { page, calls } = fakePage();
    await playwrightPage(page).fill(control({ type: "select" }), "India");
    expect(calls).toEqual(['select:[id="field"]=India']);
  });

  it("quotes an id containing a colon or a quote", async () => {
    const { page, calls } = fakePage();
    const runtime = playwrightPage(page);
    await runtime.fill(control({ id: ":r1:", type: "text" }), "Ada");
    await runtime.fill(control({ id: 'a"b', type: "text" }), "Ada");
    expect(calls).toEqual(['fill:[id=":r1:"]=Ada', 'fill:[id="a\\"b"]=Ada']);
  });
});
