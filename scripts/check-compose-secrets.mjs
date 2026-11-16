#!/usr/bin/env node
/**
 * Gate 1.7b — proves the property `docker compose config` would refuse to start
 * without .env, on a machine that has no Docker.
 *
 * It checks the two things that decide Compose's behaviour, directly in the file:
 *
 *   1. Every required secret is interpolated with the REQUIRED form `${VAR:?msg}`
 *      and never with a default `${VAR:-...}`, and is never given a literal value
 *      in the file.
 *   2. Expanding the file the way Compose documents — `${VAR:?msg}` fails when the
 *      variable is unset or empty, `${VAR:-x}` falls back, bare `${VAR}` becomes
 *      empty — fails with an empty environment and succeeds with the four secrets
 *      set.
 *
 * What this does NOT do is run Docker's own validator. It is a mechanical proof
 * of the file against the documented rule, not an invocation of `docker compose
 * config` (that needs the docker binary, which this machine does not have). The
 * distinction is written down in docs/GATES.md.
 *
 *   node scripts/check-compose-secrets.mjs [file] [--self-test]
 */
import fs from "node:fs";

/** The four secrets the stack must not be able to invent (see the file header). */
export const REQUIRED_SECRETS = [
  "APP_ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
  "POSTGRES_PASSWORD",
  "ADMIN_PASSWORD",
];

/** `${NAME}`, `${NAME:?msg}` and `${NAME:-default}` — the forms Compose documents. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g;

class MissingVariable extends Error {
  constructor(name, message) {
    super(`Missing variable "${name}": ${message || "(no message)"}`);
    this.name = "MissingVariable";
    this.variable = name;
  }
}

/** The documented substitution rules, applied to the whole file at once. */
export function expand(source, env) {
  return source.replace(REFERENCE, (_match, name, operator, argument) => {
    const value = env[name];
    const missing = value === undefined || value === "";
    if (operator === "?") {
      if (missing) throw new MissingVariable(name, argument);
      return value;
    }
    if (operator === "-") return missing ? argument : value;
    // A bare reference expands to empty when unset; Compose only warns.
    return value ?? "";
  });
}

/** Collects every reference so the audit can talk about each one by line. */
export function referencesOf(source) {
  const references = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(REFERENCE)) {
      references.push({
        line: index + 1,
        name: match[1],
        operator: match[2] ?? null,
        argument: match[3] ?? "",
      });
    }
  });
  return references;
}

/**
 * The audit itself. Returns the list of failures; an empty list means the file
 * cannot come up without the secrets, by construction.
 */
export function check(source, required = REQUIRED_SECRETS) {
  const failures = [];
  const references = referencesOf(source);

  for (const name of required) {
    const own = references.filter((reference) => reference.name === name);
    if (own.length === 0) {
      failures.push(`${name}: not interpolated anywhere in the file`);
      continue;
    }
    for (const reference of own) {
      if (reference.operator !== "?") {
        failures.push(
          `${name}: line ${reference.line} uses "${reference.operator === null ? "bare" : `:-`}", so the stack would start without it`,
        );
      }
    }
    // A literal assignment would satisfy Compose without any secret existing.
    const literal = new RegExp(`^\\s*${name}\\s*:\\s*(?!\\$\\{|\\*)(\\S+)`, "m").exec(source);
    if (literal) {
      failures.push(`${name}: has a literal value in the file ("${literal[1]}")`);
    }
  }

  // The empty environment is the case that matters: `docker compose config` with
  // no .env must refuse, and it must name the variable.
  let refusedFor = null;
  try {
    expand(source, {});
  } catch (error) {
    if (error instanceof MissingVariable) refusedFor = error.variable;
    else failures.push(`unexpected error with an empty environment: ${error.message}`);
  }
  if (!refusedFor) {
    failures.push("expanding with an empty environment did not refuse");
  }

  // And the happy path: with all four set, expansion succeeds and the password
  // reaches the database URL.
  const env = Object.fromEntries(required.map((name) => [name, `value-for-${name}`]));
  try {
    const expanded = expand(source, env);
    if (!expanded.includes(`postgresql://jobpilot:value-for-POSTGRES_PASSWORD@`)) {
      failures.push("the expanded DATABASE_URL does not carry POSTGRES_PASSWORD");
    }
  } catch (error) {
    failures.push(`expanding with every secret set failed: ${error.message}`);
  }

  // Every secret on its own: with all the others set, its absence must still stop
  // the expansion and must be reported under its own name, not someone else's.
  const perSecret = [];
  for (const name of required) {
    const partial = { ...env };
    delete partial[name];
    try {
      expand(source, partial);
      failures.push(`${name}: the file still expanded with ${name} missing`);
      perSecret.push({ name, refused: false });
    } catch (error) {
      const correct = error instanceof MissingVariable && error.variable === name;
      if (!correct) {
        failures.push(`${name}: refused by name "${error.variable ?? error.message}" instead`);
      }
      perSecret.push({ name, refused: correct });
    }
  }

  return { failures, references, refusedFor, perSecret };
}

function main() {
  const args = process.argv.slice(2);
  const selfTest = args.includes("--self-test");
  const file = args.find((argument) => !argument.startsWith("--")) ?? "docker-compose.yml";
  const source = fs.readFileSync(file, "utf8");

  const { failures, references, refusedFor, perSecret } = check(source);
  const own = references.filter((reference) => REQUIRED_SECRETS.includes(reference.name));

  console.log(`${file}: ${references.length} interpolation(s), ${own.length} on required secrets`);
  for (const name of REQUIRED_SECRETS) {
    const count = own.filter((reference) => reference.name === name).length;
    console.log(`  ${count > 0 ? "ok  " : "FAIL"} ${name}: ${count} reference(s), all required-form`);
  }
  console.log(
    `  ${refusedFor ? "ok  " : "FAIL"} empty environment refused, naming ${refusedFor ?? "(nothing)"}`,
  );
  for (const entry of perSecret) {
    console.log(
      `  ${entry.refused ? "ok  " : "FAIL"} ${entry.name} on its own: refused by name when unset`,
    );
  }

  for (const failure of failures) console.error(`FAIL ${failure}`);

  if (selfTest) {
    // A checker that cannot fail proves nothing, so a mutated copy must fail it.
    const broken = source.replace(
      "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432",
      "${POSTGRES_PASSWORD:-changeme}@db:5432",
    );
    const mutant = check(broken);
    if (mutant.failures.length === 0) {
      console.error("FAIL self-test: a file with a default password was accepted");
      process.exit(1);
    }
    console.log(
      `self-test ok: a mutated copy with ${"${POSTGRES_PASSWORD:-changeme}"} was rejected ` +
        `(${mutant.failures.length} failure(s))`,
    );
  }

  if (failures.length > 0) process.exit(1);
  console.log("OK: the stack cannot start without the four secrets");
}

if (process.argv[1] && process.argv[1].endsWith("check-compose-secrets.mjs")) main();
