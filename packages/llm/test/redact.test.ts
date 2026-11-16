import { describe, it, expect } from "vitest";
import { redact, redactDeep } from "../src/redact.js";

describe("redact (gate 1.13)", () => {
  it.each([
    ["contact me at priya.sharma@example.com today", "contact me at [EMAIL] today"],
    [
      "email j.doe+work@sub.example.co.uk or die@x.io",
      "email [EMAIL] or [EMAIL]",
    ],
    ["call +91 98765 43210 now", "call [PHONE] now"],
    ["phone: (415) 555-1234", "phone: [PHONE]"],
    ["fax 415-555-1234", "fax [PHONE]"],
    ["I live at 221B Baker Street", "I live at [ADDRESS]"],
    ["ship to 12 Main Street, Apt 3", "ship to [ADDRESS], Apt 3"],
    ["office: 500 Oracle Parkway", "office: 500 Oracle Parkway"],
    ["no sensitive data here", "no sensitive data here"],
  ])("redacts %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("redacts deeply inside objects and arrays", () => {
    const input = {
      a: "mail me: a@b.co",
      list: ["at 5 Wall Street", 42, null],
      nested: { phone: "+1 212 555 0199" },
    };
    const out = redactDeep(input) as typeof input;
    expect(out.a).toBe("mail me: [EMAIL]");
    expect(out.list[0]).toBe("at [ADDRESS]");
    expect(out.list[1]).toBe(42);
    expect(out.nested.phone).toBe("[PHONE]");
  });
});

describe("gate 2.8: Indian addresses and PIN codes are redacted (L2)", () => {
  it("masks a flat-and-road address and its PIN code", () => {
    const redacted = redact("Flat 12, MG Road, Bengaluru 560001");
    expect(redacted).toContain("[ADDRESS]");
    expect(redacted).toContain("[PIN]");
    expect(redacted).not.toContain("MG Road");
    expect(redacted).not.toContain("560001");
  });

  it("still masks a phone number", () => {
    expect(redact("call 9876543210")).toBe("call [PHONE]");
  });

  it("leaves ordinary numbers alone", () => {
    const text = "I joined in 2019 and shipped three services.";
    expect(redact(text)).toBe(text);
  });
});
