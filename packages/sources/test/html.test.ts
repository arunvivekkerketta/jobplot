import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "../src/html.js";

describe("gate 3.8: description HTML to text", () => {
  const html =
    "<div><p>Hello &amp; welcome</p><script>alert('x')</script>" +
    "<style>.x{color:red}</style><ul><li>One</li><li>Two</li></ul>" +
    "<p>Caf&#233; &#8212; done</p><!-- hidden --><p>Last&nbsp;line</p></div>";

  const text = htmlToText(html);

  it("removes executable and hidden blocks", () => {
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("hidden");
  });

  it("decodes named and numeric entities", () => {
    expect(text).toContain("Hello & welcome");
    expect(text).toContain("Caf\u00e9 \u2014 done");
    expect(text).toContain("Last line");
  });

  it("keeps list items as separate lines", () => {
    const lines = text.split("\n");
    expect(lines).toContain("- One");
    expect(lines).toContain("- Two");
  });

  it("decodes entities through the exported helper", () => {
    expect(decodeEntities("&lt;tag&gt; &amp; &#39;quoted&#39;")).toBe("<tag> & 'quoted'");
  });
});
