import type { RawControl, RunnerPage } from "./runner.js";

/** The Playwright methods this adapter needs; kept structural so the package
 * never depends on Playwright itself. */
export interface LocatorLike {
  fill(value: string): Promise<void>;
  check(): Promise<void>;
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
      const explicit = document.querySelector(`label[for="${element.id}"]`);
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

/** Serialized into the page; the pattern arrives as an argument. */
function findButtons(pattern: string): number[] {
  const matcher = new RegExp(pattern, "i");
  const found: number[] = [];
  Array.from(document.querySelectorAll("button, input[type=submit]")).forEach(
    (button, index) => {
      const text =
        (button as HTMLInputElement).value || (button.textContent ?? "").trim();
      if (matcher.test(text)) found.push(index);
    },
  );
  return found;
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
  const location = (control: RawControl): LocatorLike =>
    control.id
      ? page.locator(`#${control.id}`)
      : page.locator(CONTROL_SELECTOR).nth(control.index);

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
      if (control.type === "radio" || control.type === "checkbox") {
        await target.check();
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