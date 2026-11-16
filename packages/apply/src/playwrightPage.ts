import type { RawControl, RunnerPage } from "./runner.js";

/** The Playwright methods this adapter needs; kept structural so the package
 * never depends on Playwright itself. */
export interface LocatorLike {
  fill(value: string): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  selectOption(option: { label: string } | string): Promise<unknown>;
  setInputFiles(path: string): Promise<void>;
  click(): Promise<void>;
  innerText(): Promise<string>;
  nth(index: number): LocatorLike;
}

export interface PageLike {
  goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load" }): Promise<unknown>;
  locator(selector: string): LocatorLike;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  evaluate<TArg, T>(pageFunction: (arg: TArg) => T, arg: TArg): Promise<T>;
}

/** Serialized into the page; must not close over module scope. */
function collectControls(): RawControl[] {
  const elements = Array.from(
    document.querySelectorAll("input, textarea, select"),
  ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

  return elements.map((element, index) => {
    let label = "";
    if (element.id) {
      // An id can contain quotes, so it is escaped before it becomes a selector.
      const escapedId = element.id.replace(/["\\]/g, "\\$&");
      const explicit = document.querySelector(`label[for="${escapedId}"]`);
      if (explicit) label = (explicit.textContent ?? "").trim();
    }
    if (!label) {
      const wrapping = element.closest("label");
      if (wrapping) label = (wrapping.textContent ?? "").trim();
    }
    if (!label) label = element.getAttribute("aria-label") ?? "";

    return {
      index,
      label,
      name: element.getAttribute("name") ?? "",
      id: element.id,
      autocomplete: element.getAttribute("autocomplete") ?? "",
      type: element.getAttribute("type") ?? element.tagName.toLowerCase(),
    };
  });
}

/**
 * Serialized into the page; the pattern arrives as an argument. Everything it
 * uses must live inside the function: the browser cannot see module scope, so a
 * module-level regex here fails at run time with "is not defined".
 */
function findButtons(pattern: string): number[] {
  const matcher = new RegExp(pattern, "i");
  // A social sign-in or a "save for later" link is never the submit control.
  const ignored =
    /(with\s+(google|linkedin|github|facebook|apple|microsoft)|sign\s*in|log\s*in|save\s+and\s+continue\s+later|later)/i;
  const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
  const firstVisible = inputs.find(
    (element) => (element as HTMLElement).offsetParent !== null,
  );
  const form = firstVisible?.closest("form") ?? null;

  const found: Array<{ index: number; inForm: boolean }> = [];
  Array.from(document.querySelectorAll("button, input[type=submit]")).forEach(
    (button, index) => {
      const element = button as HTMLElement;
      const text = (button as HTMLInputElement).value || (element.textContent ?? "").trim();
      if (!matcher.test(text)) return;
      if (ignored.test(text)) return;
      // A hidden button cannot be clicked and must not be chosen.
      if (element.offsetParent === null) return;
      found.push({ index, inForm: form !== null && form.contains(element) });
    },
  );

  // The button next to the fields is the form's own submit, not one in a sidebar.
  return found
    .sort((a, b) => Number(b.inForm) - Number(a.inForm))
    .map((entry) => entry.index);
}

/** Serialized into the page; challenge widgets are matched in the DOM, not by text. */
function detectChallenge(): boolean {
  const selectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[title*="captcha" i]',
    ".g-recaptcha",
    ".h-captcha",
    ".cf-turnstile",
    "[data-sitekey]",
  ];
  return selectors.some((selector) => document.querySelector(selector) !== null);
}

const CONTROL_SELECTOR = "input, textarea, select";
const BUTTON_SELECTOR = "button, input[type=submit]";

export function playwrightPage(page: PageLike): RunnerPage {
  // `#:r1:` is not a valid selector, and an id may contain quotes; the attribute
  // form with escaping handles both.
  const location = (control: RawControl): LocatorLike =>
    control.id
      ? page.locator(`[id="${control.id.replace(/["\\]/g, "\\$&")}"]`)
      : page.locator(CONTROL_SELECTOR).nth(control.index);

  const AFFIRMATIVE = new Set(["yes", "true", "y", "1", "agree", "i agree"]);
  const NEGATIVE = new Set(["no", "false", "n", "0"]);

  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    async controls() {
      return page.evaluate(collectControls);
    },
    async buttonIndices(pattern) {
      return page.evaluate(findButtons, pattern);
    },
    async fill(control, value) {
      const target = location(control);
      const answer = value.trim().toLowerCase();

      if (control.type === "checkbox") {
        // An unmapped answer must fail the application, never tick a consent box
        // the user did not agree to (I5).
        if (AFFIRMATIVE.has(answer)) {
          await target.check();
          return;
        }
        if (NEGATIVE.has(answer)) {
          await target.uncheck();
          return;
        }
        throw new Error("Cannot map answer to a checkbox");
      }

      if (control.type === "radio") {
        // Only the option whose own label matches the answer is selected.
        if (control.label.trim().toLowerCase() === answer) {
          await target.check();
        }
        return;
      }

      if (control.type === "select" || control.type === "select-one") {
        try {
          await target.selectOption({ label: value });
        } catch {
          await target.selectOption(value);
        }
        return;
      }

      await target.fill(value);
    },
    async attach(control, path) {
      await location(control).setInputFiles(path);
    },
    async clickButton(index) {
      await page.locator(BUTTON_SELECTOR).nth(index).click();
    },
    async bodyText() {
      return page.locator("body").innerText();
    },
    async challengePresent() {
      return page.evaluate(detectChallenge);
    },
  };
}