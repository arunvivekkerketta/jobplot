import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHashOf } from "../src/canonical.js";

describe("gate 3.2: canonical posting URLs", () => {
  it("strips tracking params, fragments, default ports and trailing slashes", () => {
    expect(
      canonicalizeUrl(
        "https://WWW.Example.com:443/jobs/123/?utm_source=x&utm_medium=y&fbclid=z#apply",
      ),
    ).toBe("https://example.com/jobs/123");
  });

  it("keeps meaningful params and sorts them for stability", () => {
    expect(canonicalizeUrl("https://example.com/job?b=2&a=1&ref=newsletter")).toBe(
      "https://example.com/job?a=1&b=2",
    );
  });

  it("collapses the same posting reached from different surfaces", () => {
    const fromEmail = canonicalizeUrl(
      "https://boards.greenhouse.io/acme/jobs/1?utm_source=linkedin&gh_src=abc",
    );
    const fromPaste = canonicalizeUrl("https://boards.greenhouse.io/acme/jobs/1/");
    expect(fromEmail).toBe(fromPaste);
  });
});

describe("gate 3.3: content hashing", () => {
  const base = {
    title: "Senior Backend Engineer",
    company: "Acme",
    descriptionText: "Build Python services on Kubernetes.",
  };

  it("ignores case, punctuation spacing and whitespace churn", () => {
    expect(
      contentHashOf({
        ...base,
        title: "  senior   BACKEND engineer ",
        descriptionText: "Build   Python services on\nKubernetes.",
      }),
    ).toBe(contentHashOf(base));
  });

  it("changes when the posting itself changes", () => {
    expect(
      contentHashOf({
        ...base,
        descriptionText: "Build Python services on Kubernetes and Go.",
      }),
    ).not.toBe(contentHashOf(base));
  });
});
