import { describe, expect, it } from "vitest";
import { classifyField } from "../src/fields.js";
import { answerFor, normalizeAnswerKey } from "../src/answers.js";

describe("gate 4.4: Answer Bank resolution (I5)", () => {
  it("normalizes key spellings so one entry serves every ordering", () => {
    expect(normalizeAnswerKey("work_auth")).toBe("work_auth");
    expect(normalizeAnswerKey("Work Authorization")).toBe("work_authorization");
    expect(normalizeAnswerKey("  Salary-Expectation ")).toBe("salary_expectation");
  });

  it("prefers an exact canonical key over a pattern", () => {
    const salary = classifyField({
      label: "What are your salary expectations?",
      name: "expected_ctc",
    });
    const entries = [
      { key: "salary_expectation", answer: "GBP 95,000" },
      { key: "something_else", questionPattern: "salary", answer: "never used" },
    ];
    expect(answerFor(salary, entries)?.answer).toBe("GBP 95,000");
  });

  it("falls back to questionPattern over the raw label", () => {
    const salary = classifyField({
      label: "What are your salary expectations?",
      name: "expected_ctc",
    });
    const entries = [
      { key: "comp", questionPattern: "salary\\s+expectations", answer: "GBP 90,000" },
    ];
    expect(answerFor(salary, entries)?.answer).toBe("GBP 90,000");
  });

  it("refuses to choose when two patterns match the same question", () => {
    const years = classifyField({ label: "Years of experience", name: "years" });
    const entries = [
      { key: "a", questionPattern: "experience", answer: "5" },
      { key: "b", questionPattern: "years", answer: "6" },
    ];
    expect(answerFor(years, entries)).toBeNull();
  });

  it("treats a malformed pattern as no match instead of throwing", () => {
    const email = classifyField({ label: "Email", name: "email" });
    const entries = [{ key: "bad", questionPattern: "([unclosed", answer: "x" }];
    expect(() => answerFor(email, entries)).not.toThrow();
    expect(answerFor(email, entries)).toBeNull();
  });

  it("returns null when the bank is empty", () => {
    const phone = classifyField({ label: "Phone", name: "phone" });
    expect(answerFor(phone, [])).toBeNull();
  });
});