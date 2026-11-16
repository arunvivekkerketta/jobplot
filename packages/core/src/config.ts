/**
 * Refuse to start in production with a secret that is publicly known (H4).
 *
 * The repository ships throwaway values for local development and CI. They are
 * safe only because nobody can reach those instances; a deployment that keeps
 * them has a session key and an encryption key that are in the git history.
 */

const KNOWN_DEFAULTS = new Set([
  "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
  "compose-secret-not-for-production",
  "ci-secret-not-for-production",
  "jobpilot-admin",
  "jobpilot",
]);

export interface ConfigProblem {
  name: string;
  problem: string;
}

export function findConfigProblems(env: Record<string, string | undefined>): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const secrets = ["NEXTAUTH_SECRET", "AUTH_SECRET", "APP_ENCRYPTION_KEY", "ADMIN_PASSWORD"] as const;
  for (const name of secrets) {
    const value = env[name];
    if (!value) {
      if (name === "AUTH_SECRET") continue;
      problems.push({ name, problem: "is not set" });
      continue;
    }
    if (KNOWN_DEFAULTS.has(value)) problems.push({ name, problem: "is a publicly known default value" });
    else if (name !== "APP_ENCRYPTION_KEY" && value.length < 16) problems.push({ name, problem: "is shorter than 16 characters" });
  }
  return problems;
}

export function assertProductionConfig(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== "production") return;
  const problems = findConfigProblems(env);
  if (problems.length > 0) {
    throw new Error(
      "Refusing to start in production: " + problems.map((p) => `${p.name} ${p.problem}`).join("; "),
    );
  }
}
