import { wrapUntrusted } from "@jobpilot/llm";
import {
  SENSITIVE_FIELDS,
  type CanonicalField,
  type ClassifiedField,
  type FieldDescriptor,
} from "./types.js";

/** autocomplete tokens that identify a field unambiguously. */
const AUTOCOMPLETE_MAP: Record<string, CanonicalField> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  url: "website",
  "address-level2": "location",
  "address-level1": "location",
  "address-level3": "location",
};

/** input name/id tokens, normalized to lowercase alphanumerics. */
const NAME_MAP: Record<string, CanonicalField> = {
  firstname: "first_name",
  fname: "first_name",
  givenname: "first_name",
  first: "first_name",
  lastname: "last_name",
  lname: "last_name",
  familyname: "last_name",
  surname: "last_name",
  last: "last_name",
  name: "full_name",
  fullname: "full_name",
  yourname: "full_name",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phoneNumber: "phone",
  phonenumber: "phone",
  tel: "phone",
  telephone: "phone",
  mobile: "phone",
  location: "location",
  city: "location",
  linkedin: "linkedin",
  linkedinurl: "linkedin",
  urls: "linkedin",
  website: "website",
  portfolio: "website",
  resume: "resume",
  cv: "resume",
  attachment: "resume",
  coverletter: "cover_letter",
  workauth: "work_auth",
  workauthorization: "work_auth",
  years: "years_experience",
  yearsexperience: "years_experience",
  expectedctc: "salary_expectation",
  salary: "salary_expectation",
  salaryexpectation: "salary_expectation",
};

/** Ordered label rules: specific patterns first, so "first name" beats "name". */
const LABEL_RULES: ReadonlyArray<readonly [RegExp, CanonicalField]> = [
  [/\b(first|given)\s+name\b/i, "first_name"],
  [/\b(last|family|sur)\s*name\b/i, "last_name"],
  [/\bcover\s*letter\b/i, "cover_letter"],
  [/\b(e-?mail)(\s+address)?\b/i, "email"],
  [/\b(phone|mobile|telephone|cell)\b/i, "phone"],
  [/\blinked\s*in\b/i, "linkedin"],
  [/\b(website|portfolio|personal\s+site|homepage)\b/i, "website"],
  [/\b(r[eé]sum[eé]|curriculum\s+vitae|\bcv\b)\b/i, "resume"],
  [/\b(years?\s+of\s+experience|experience\s+do\s+you\s+have)\b/i, "years_experience"],
  [/\b(salary|compensation|expected\s+(pay|ctc|rate)|day\s+rate|hourly\s+rate)\b/i, "salary_expectation"],
  [/\b(work(ing)?\s+authori[sz]ation|authori[sz]ed\s+to\s+work|right\s+to\s+work|visa|sponsorship)\b/i, "work_auth"],
  [/\b(city|location|where\s+do\s+you\s+(live|reside)|based\s+in)\b/i, "location"],
  [/\b(full|your)\s+name\b/i, "full_name"],
  [/^\s*name\s*$/i, "full_name"],
];

/**
 * Sensitive topics per I5. Detection is deliberately broad: a false positive
 * only costs a NEEDS_HUMAN field, a false negative would auto-fill an answer the
 * user never gave.
 */
const SENSITIVE_LABEL_RE =
  /\b(salary|compensation|pay\s+expectation|visa|sponsor(ship)?|work\s+authori[sz]ation|disabilit\w*|veteran\w*|criminal|convict\w*|felon\w*|background\s+check|race|racial|ethnicity|ethnic|gender|pronouns?|sexual\s+orientation|date\s+of\s+birth|ssn|social\s+security|attest\w*|certify\s+that|certification\s+of|consent\s+to|legal\s+declaration)\b/i;

/** Labels that try to instruct the agent rather than name a field (I2). */
const SUSPICIOUS_LABEL_RE =
  /(ignore\s+(all\s+|any\s+)?(your\s+|the\s+|previous\s+|above\s+)?instructions|disregard\s+(the\s+)?(above|previous|system)|system\s+prompt|you\s+are\s+now|jailbreak|override\s+(your|the)\s+(rules|instructions))/i;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Re-keys a table by its normalized token so `given-name` and `givenname` agree. */
function normalizeMap(map: Record<string, CanonicalField>): Record<string, CanonicalField> {
  const out: Record<string, CanonicalField> = {};
  for (const [key, value] of Object.entries(map)) {
    out[normalizeToken(key)] = value;
  }
  return out;
}

const AUTOCOMPLETE_LOOKUP = normalizeMap(AUTOCOMPLETE_MAP);
const NAME_LOOKUP = normalizeMap(NAME_MAP);

function lookup(map: Record<string, CanonicalField>, value?: string): CanonicalField | null {
  if (!value) return null;
  return map[normalizeToken(value)] ?? null;
}

function labelKey(label: string): CanonicalField | null {
  for (const [pattern, key] of LABEL_RULES) {
    if (pattern.test(label)) return key;
  }
  return null;
}

/**
 * Resolves one control to a canonical key. Precedence is autocomplete, then the
 * control's own name/id token, then the visible label, because a label like
 * "Name" is far more ambiguous than `autocomplete="given-name"`.
 */
export function classifyField(field: FieldDescriptor): ClassifiedField {
  const suspicious = SUSPICIOUS_LABEL_RE.test(field.label);
  const resolved =
    lookup(AUTOCOMPLETE_LOOKUP, field.autocomplete) ??
    lookup(NAME_LOOKUP, field.name) ??
    lookup(NAME_LOOKUP, field.id) ??
    labelKey(field.label);

  const sensitive =
    (resolved !== null && SENSITIVE_FIELDS.has(resolved)) ||
    SENSITIVE_LABEL_RE.test(field.label) ||
    SENSITIVE_LABEL_RE.test(field.name ?? "");

  return {
    ...field,
    // A label that tries to instruct the agent never yields a mapping: the
    // field becomes NEEDS_HUMAN instead of a value derived from its wording.
    key: suspicious ? null : resolved,
    sensitive,
    suspicious,
    untrustedLabel: wrapUntrusted("form-label", field.label),
  };
}

export function classifyFields(fields: readonly FieldDescriptor[]): ClassifiedField[] {
  return fields.map(classifyField);
}