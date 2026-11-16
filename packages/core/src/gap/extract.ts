import type { FactIndex } from "../profile/factIndex.js";

/** One posting as the gap report needs it: a title and whatever was parsed. */
export interface GapJob {
  id: string;
  title: string;
  parsed: unknown;
}

export interface GapEntry {
  keyword: string;
  jobsMentioning: number;
  /** The postings that mentioned it, so callers never re-scan parsed data. */
  jobIds: string[];
  haveIt: boolean;
}

export interface ProjectIdea {
  title: string;
  skills: string[];
  steps: string[];
  doneWhen: string;
}

function keywordsOf(parsed: unknown): string[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const keywords = (parsed as { keywords?: unknown }).keywords;
  if (!Array.isArray(keywords)) return [];
  return keywords.filter((value): value is string => typeof value === "string");
}

/**
 * What the top postings ask for, and whether the profile can already prove it
 * (I1: the answer comes from the Fact Index, not from a model).
 *
 * A keyword counts once per posting, so one talkative description cannot make a
 * skill look three times more demanded than it is.
 */
export function extractGap(
  jobs: readonly GapJob[],
  index: FactIndex,
  topN = 20,
): GapEntry[] {
  const counts = new Map<string, { keyword: string; jobIds: Set<string> }>();

  for (const job of jobs.slice(0, topN)) {
    const seen = new Set<string>();
    for (const raw of keywordsOf(job.parsed)) {
      const keyword = raw.trim();
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) existing.jobIds.add(job.id);
      else counts.set(key, { keyword, jobIds: new Set([job.id]) });
    }
  }

  return [...counts.values()]
    .map((entry) => ({
      keyword: entry.keyword,
      jobsMentioning: entry.jobIds.size,
      jobIds: [...entry.jobIds],
      haveIt: index.hasSkill(entry.keyword),
    }))
    .sort(
      (a, b) => b.jobsMentioning - a.jobsMentioning || a.keyword.localeCompare(b.keyword),
    );
}

/**
 * Deterministic project suggestions for the skills that are missing. No model is
 * called: the same list produces the same ideas, and nothing here can add a skill
 * to the profile (I1).
 */
const PROJECTS: Readonly<Record<string, ProjectIdea>> = {
  docker: {
    title: "Containerise one of your existing services",
    skills: ["docker"],
    steps: [
      "Write a multi-stage Dockerfile for a service you already own",
      "Pin the base image tag and run as a non-root user",
      "Add a .dockerignore and rebuild to check the image got smaller",
      "Run it with a mounted config volume",
      "Document the build and run commands in the README",
    ],
    doneWhen: "A fresh clone builds and runs the container with one documented command.",
  },
  kubernetes: {
    title: "Deploy a small service to a local cluster",
    skills: ["kubernetes", "docker"],
    steps: [
      "Start a local single-node cluster",
      "Write a Deployment and a Service manifest for your own image",
      "Add readiness and liveness probes",
      "Roll out a new image tag and watch the rollout complete",
      "Scale to three replicas, then back to one",
    ],
    doneWhen: "The service answers on the service address and survives a pod restart.",
  },
  terraform: {
    title: "Provision a single resource with Terraform",
    skills: ["terraform"],
    steps: [
      "Pin the provider version in a required_providers block",
      "Define one resource with variables instead of hard-coded values",
      "Run plan, apply, then plan again to show no drift",
      "Move the state to a remote backend",
      "Write a README with the apply and destroy commands",
    ],
    doneWhen: "plan shows no changes after apply, and destroy removes everything created.",
  },
  aws: {
    title: "Ship a small service to AWS and watch it",
    skills: ["aws"],
    steps: [
      "Create one compute resource with least-privilege IAM",
      "Store configuration outside the code",
      "Add a health check and a log group",
      "Send one request and read the log entry it produced",
      "Tear the stack down",
    ],
    doneWhen: "The service responds, the logs show the request, and teardown leaves nothing billed.",
  },
  postgresql: {
    title: "Index and measure a real query",
    skills: ["postgresql"],
    steps: [
      "Take a slow query against your own data",
      "Read its plan before any change",
      "Add the index the plan is missing",
      "Read the plan again and compare the cost",
      "Write down the before and after timing",
    ],
    doneWhen: "The same query runs measurably faster and the plan shows the new index.",
  },
  redis: {
    title: "Add a cache with an honest invalidation rule",
    skills: ["redis"],
    steps: [
      "Pick one read-heavy endpoint",
      "Cache the response with a short TTL",
      "Invalidate it on the write that changes the data",
      "Measure the hit rate under repeated requests",
      "Document what happens when Redis is down",
    ],
    doneWhen: "Repeated reads hit the cache and stale data is never served after a write.",
  },
  kafka: {
    title: "Publish and consume one event",
    skills: ["kafka"],
    steps: [
      "Define the event schema and its version",
      "Publish one event from a producer",
      "Consume it with a consumer group",
      "Make the consumer idempotent",
      "Restart the consumer and show it does not double-process",
    ],
    doneWhen: "A restarted consumer processes no duplicate event.",
  },
  graphql: {
    title: "Add one query to a schema",
    skills: ["graphql"],
    steps: [
      "Define the type and query in a schema",
      "Resolve it against existing data",
      "Add an argument and handle its absence",
      "Write one integration test for the query",
      "Document the query in the README",
    ],
    doneWhen: "The query returns the expected shape and the test fails if the resolver breaks.",
  },
  typescript: {
    title: "Make one module strict end to end",
    skills: ["typescript"],
    steps: [
      "Find a module using any or a cast",
      "Replace the boundary with a parsing schema",
      "Turn on the strictest compiler flags for that module",
      "Delete the leftover casts",
      "Run the type checker in CI",
    ],
    doneWhen: "The module compiles with no any, no casts and no suppression comments.",
  },
  react: {
    title: "Rebuild one screen with real states",
    skills: ["react"],
    steps: [
      "List the loading, empty, error and success states",
      "Render each one explicitly",
      "Move data fetching out of the render path",
      "Add keyboard focus handling for the primary action",
      "Write one test per state",
    ],
    doneWhen: "Every state renders without a data source and the tests cover all four.",
  },
  python: {
    title: "Package one script properly",
    skills: ["python"],
    steps: [
      "Split the script into a module and an entry point",
      "Add typed function signatures",
      "Add a virtual environment and a lock file",
      "Write tests for the pure functions",
      "Run the tests in CI",
    ],
    doneWhen: "A fresh environment installs the package and the test suite passes.",
  },
  go: {
    title: "Write one service with graceful shutdown",
    skills: ["go"],
    steps: [
      "Serve one endpoint with a context-aware handler",
      "Add a readiness endpoint",
      "Handle SIGTERM by draining in-flight requests",
      "Write a table-driven test for the handler",
      "Build a static binary in CI",
    ],
    doneWhen: "Sending SIGTERM finishes in-flight requests and exits cleanly.",
  },
  "ci/cd": {
    title: "Gate merges on a real check",
    skills: ["ci/cd"],
    steps: [
      "Add a workflow that installs and type-checks",
      "Fail the job on any warning you care about",
      "Cache the dependency install",
      "Require the job before merging",
      "Break the build once on purpose to prove it blocks",
    ],
    doneWhen: "A deliberately broken commit cannot merge and the cache hit is visible.",
  },
  testing: {
    title: "Cover one risky path with a real test",
    skills: ["testing"],
    steps: [
      "Pick the path most likely to lose data",
      "Write the failing test first",
      "Fix the code until it passes",
      "Add the case that used to slip through",
      "Run the suite in CI",
    ],
    doneWhen: "The test fails when the fix is reverted.",
  },
};

export function suggestProjects(missing: readonly string[], limit = 3): ProjectIdea[] {
  const ideas: ProjectIdea[] = [];
  const seen = new Set<string>();

  for (const skill of missing) {
    const key = skill.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const idea = PROJECTS[key];
    if (idea) {
      ideas.push(idea);
    } else {
      ideas.push({
        title: `Build a small project that uses ${skill}`,
        skills: [skill],
        steps: [
          `Write down what ${skill} is for in one sentence`,
          `Build the smallest thing that uses ${skill} end to end`,
          "Add one test or check that fails when it is misconfigured",
          "Write a README with the commands you ran",
        ],
        doneWhen: "Someone else can follow the README and reproduce the result.",
      });
    }
    if (ideas.length >= limit) break;
  }

  return ideas;
}
