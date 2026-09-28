/**
 * Redaction of PII before logging or LLM calls (invariant I7).
 * Masks emails, phone numbers and street addresses.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PHONE_RE =
  /(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4})|(?:\+\d{1,3}[\s.-]?\d{5}[\s.-]?\d{5})|(?:(?:\+\d{1,3}[\s.-]?)?\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b)/g;

const STREET_RE =
  /\b\d{1,5}[A-Za-z]?\s+[A-Za-z0-9.]+\s+(?:[A-Za-z]+\s){0,2}?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/gi;

export function redact(text: string): string {
  return text
    .replace(STREET_RE, "[ADDRESS]")
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, "[PHONE]");
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
