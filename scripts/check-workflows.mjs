#!/usr/bin/env node
/**
 * A local, actionlint-shaped check for the GitHub Actions templates.
 *
 * `actionlint` itself is a Go binary, so it cannot be installed on a machine with
 * no network and no Go toolchain; this script applies the subset of its rules that
 * catches the mistakes that actually break a workflow: a file that does not parse,
 * a job with no runner, a step with neither `run` nor `uses`, a `needs` that names
 * a job that does not exist, a misspelled top-level key, an unbalanced `${{ }}`
 * expression, a duplicate step id, and a `uses:` without a version.
 *
 * It is a structural validator, not an expression evaluator: it cannot prove a
 * `${{ }}` expression is type-correct the way actionlint can. That limit is
 * written down in docs/GATES.md rather than papered over.
 *
 *   node scripts/check-workflows.mjs [--self-test] [file...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const WORKFLOW_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.github/workflows",
);

const ROOT_KEYS = new Set([
  "name",
  "run-name",
  "on",
  "permissions",
  "env",
  "defaults",
  "concurrency",
  "jobs",
]);

const JOB_KEYS = new Set([
  "name",
  "runs-on",
  "needs",
  "if",
  "env",
  "steps",
  "timeout-minutes",
  "strategy",
  "services",
  "permissions",
  "concurrency",
  "container",
  "outputs",
  "uses",
  "with",
  "secrets",
  "continue-on-error",
  "defaults",
  "environment",
]);

const STEP_KEYS = new Set([
  "name",
  "id",
  "if",
  "run",
  "uses",
  "with",
  "env",
  "shell",
  "working-directory",
  "continue-on-error",
  "timeout-minutes",
]);

/** `owner/repo@ref`, `owner/repo/path@ref`, or a local `./path` action. */
const USES_RE = /^(?:\.\/[\w./-]+|[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[\w.\-/]+)$/;

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `${{ … }}` openers must be closed the same number of times, in order. */
function unbalancedExpressions(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("${{", index)) {
      depth += 1;
      index += 2;
    } else if (text.startsWith("}}", index) && depth > 0) {
      depth -= 1;
      index += 1;
    }
  }
  return depth !== 0;
}

function collectStrings(node, pathSoFar, out) {
  if (typeof node === "string") out.push([pathSoFar, node]);
  else if (Array.isArray(node)) node.forEach((item, index) => collectStrings(item, `${pathSoFar}[${index}]`, out));
  else if (isMapping(node)) {
    for (const [key, value] of Object.entries(node)) collectStrings(value, `${pathSoFar}.${key}`, out);
  }
}

/**
 * Every failure for one workflow source, as `"<where>: <message>"`. Never throws
 * for a bad workflow: a parse error is a failure like any other.
 */
export function checkWorkflow(source, label = "workflow.yml") {
  const failures = [];
  const fail = (where, message) => failures.push(`${label}${where ? `: ${where}` : ""}: ${message}`);

  let doc;
  try {
    doc = yaml.load(source);
  } catch (error) {
    const mark = error && typeof error === "object" ? error.mark : undefined;
    const position = mark ? `:${mark.line + 1}:${mark.column + 1}` : "";
    return [`${label}${position}: YAML does not parse — ${error.message.split("\n")[0]}`];
  }

  if (!isMapping(doc)) return [`${label}: the file is not a mapping`];

  for (const key of Object.keys(doc)) {
    if (!ROOT_KEYS.has(key)) fail("", `unknown top-level key "${key}"`);
  }
  if (doc.on === undefined) fail("", 'missing "on" (the workflow has no trigger)');
  if (!isMapping(doc.jobs) || Object.keys(doc.jobs).length === 0) {
    return [...failures, `${label}: "jobs" must be a non-empty mapping`];
  }

  const jobIds = new Set(Object.keys(doc.jobs));
  for (const [jobId, job] of Object.entries(doc.jobs)) {
    const where = `jobs.${jobId}`;
    if (!isMapping(job)) {
      fail(where, "is not a mapping");
      continue;
    }
    for (const key of Object.keys(job)) {
      if (!JOB_KEYS.has(key)) fail(where, `unknown job key "${key}"`);
    }

    const reusable = job.uses !== undefined;
    if (reusable) {
      if (typeof job.uses !== "string" || !USES_RE.test(job.uses)) {
        fail(where, `"uses" is not a valid action reference: ${String(job.uses)}`);
      }
      if (job.steps !== undefined) fail(where, "a reusable-workflow job cannot also have steps");
    } else if (job["runs-on"] === undefined) {
      fail(where, 'has no "runs-on" runner');
    }

    const needs = job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
    for (const need of needs) {
      if (typeof need !== "string") fail(where, `"needs" contains a non-string: ${String(need)}`);
      else if (!jobIds.has(need)) fail(where, `"needs" names an unknown job "${need}"`);
      else if (need === jobId) fail(where, `"needs" refers to itself`);
    }

    if (!reusable) {
      if (!Array.isArray(job.steps) || job.steps.length === 0) {
        fail(where, 'has no "steps"');
      } else {
        const stepIds = new Set();
        job.steps.forEach((step, index) => {
          const stepWhere = `${where}.steps[${index}]`;
          if (!isMapping(step)) {
            fail(stepWhere, "is not a mapping");
            return;
          }
          for (const key of Object.keys(step)) {
            if (!STEP_KEYS.has(key)) fail(stepWhere, `unknown step key "${key}"`);
          }
          const hasRun = typeof step.run === "string" && step.run.trim().length > 0;
          const hasUses = step.uses !== undefined;
          if (hasRun && hasUses) fail(stepWhere, "has both run and uses");
          if (!hasRun && !hasUses) fail(stepWhere, 'has neither "run" nor "uses"');
          if (step.run !== undefined && !hasRun) fail(stepWhere, 'has an empty "run"');
          if (hasUses && (typeof step.uses !== "string" || !USES_RE.test(step.uses))) {
            fail(stepWhere, `"uses" is not a valid action reference: ${String(step.uses)}`);
          }
          if (step.id !== undefined) {
            if (typeof step.id !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(step.id)) {
              fail(stepWhere, `"id" is not a valid identifier: ${String(step.id)}`);
            } else if (stepIds.has(step.id)) {
              fail(stepWhere, `duplicate step id "${step.id}"`);
            } else {
              stepIds.add(step.id);
            }
          }
        });
      }
    }
  }

  const strings = [];
  collectStrings(doc, "", strings);
  for (const [where, value] of strings) {
    if (unbalancedExpressions(value)) {
      fail(where.replace(/^\./, "") || "workflow", `unbalanced \${{ }} expression: ${value.slice(0, 60)}`);
    }
  }

  return failures;
}

/** Reads every workflow file and returns the failures across all of them. */
export function checkDirectory(dir = WORKFLOW_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  if (files.length === 0) return [`${dir}: no workflow files found`];

  const failures = [];
  for (const name of files) {
    failures.push(...checkWorkflow(fs.readFileSync(path.join(dir, name), "utf8"), name));
  }
  return failures;
}

/** Mutations the checker must reject, so a green run means something. */
const MUTANTS = [
  {
    name: "a job with no runner",
    mutate: (source) => source.replace(/^(\s+)runs-on: ubuntu-latest$/m, ""),
  },
  {
    name: "a needs that names a missing job",
    mutate: (source) => source.replace(/^(\s+)needs: checks$/m, "$1needs: no-such-job"),
  },
  {
    name: "a uses without a version",
    mutate: (source) => source.replace(/actions\/checkout@v4/, "actions/checkout"),
  },
  {
    name: "an unbalanced expression",
    mutate: (source) => source.replace("${{ github.ref }}", "${{ github.ref"),
  },
  {
    name: "a step with neither run nor uses",
    mutate: (source) =>
      source.replace(
        /^(\s+)- name: Install dependencies\n\s+run: pnpm install --frozen-lockfile$/m,
        "$1- name: Install dependencies",
      ),
  },
  {
    name: "a file that is not YAML",
    mutate: () => "name: [unclosed\n",
  },
];

function selfTest(sources) {
  let failures = 0;
  for (const mutant of MUTANTS) {
    const source = mutant.mutate(sources[0]?.source ?? "");
    const caught = source === (sources[0]?.source ?? "") ? ["unchanged: mutation did not apply"] : checkWorkflow(source, "mutant.yml");
    if (caught.length === 0) {
      console.error(`FAIL self-test: ${mutant.name} was accepted`);
      failures += 1;
    } else {
      console.log(`self-test ok: ${mutant.name} was rejected (${caught.length} failure(s))`);
    }
  }
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const selfTestFlag = args.includes("--self-test");
  const files = args.filter((arg) => !arg.startsWith("--"));

  const sources = files.length
    ? files.map((file) => ({ name: path.basename(file), source: fs.readFileSync(file, "utf8") }))
    : fs
        .readdirSync(WORKFLOW_DIR)
        .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
        .sort()
        .map((name) => ({
          name,
          source: fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8"),
        }));

  if (sources.length === 0) {
    console.error(`FAIL no workflow files found in ${WORKFLOW_DIR}`);
    process.exit(1);
  }

  const failures = [];
  for (const { name, source } of sources) failures.push(...checkWorkflow(source, name));
  for (const failure of failures) console.error(`FAIL ${failure}`);

  let selfTestFailures = 0;
  if (selfTestFlag) {
    selfTestFailures = selfTest(sources);
  }

  if (failures.length > 0 || selfTestFailures > 0) {
    console.error(`FAILED: ${failures.length} workflow problem(s)`);
    process.exit(1);
  }
  console.log(
    `OK: ${sources.length} workflow file(s) valid${selfTestFlag ? ", and the checker rejects its mutants" : ""}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("check-workflows.mjs")) main();
