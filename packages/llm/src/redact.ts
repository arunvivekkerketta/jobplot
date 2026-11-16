/**
 * Redaction of PII before logging or LLM calls (invariant I7).
 * Masks emails, phone numbers and street addresses.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PHONE_RE =
  /(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4})|(?:\+\d{1,3}[\s.-]?\d{5}[\s.-]?\d{5})|(?:(?:\+\d{1,3}[\s.-]?)?\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b)/g;

const STREET_RE =
  /\b\d{1,5}[A-Za-z]?\s+[A-Za-z0-9.]+\s+(?:[A-Za-z]+\s){0,2}?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/gi;

// Indian-style addresses put the flat or plot number first and separate the parts
// with commas: "Flat 12, MG Road" or "Plot 4, Sector 5, Baner Layout".
const INDIAN_STREET_RE =
  /\b(?:(?:Flat|House|Plot)\s*(?:No\.?\s*)?\d{1,5}|\d{1,5}[A-Za-z]?)[,\s]+(?:[A-Za-z0-9.]+[,\s]+){0,5}?(?:Road|Rd|Street|St|Nagar|Colony|Layout|Marg|Lane|Cross|Main)\b\.?/gi;

// A six-digit Indian PIN code, with or without the space: 560001 and 560 001.
// Four-digit years do not match, because six digits are required.
const PIN_RE = /\b[1-9]\d{2}\s?\d{3}\b/g;

export function redact(text: string): string {
  return text
    .replace(STREET_RE, "[ADDRESS]")
    .replace(INDIAN_STREET_RE, "[ADDRESS]")
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, "[PHONE]")
    .replace(PIN_RE, "[PIN]");
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
