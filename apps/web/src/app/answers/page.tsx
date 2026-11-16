import { buildAnswerCoverage, coverageSummary } from "@jobpilot/apply";
import { listAnswers, listMissingAnswerKeys, listNotifyStops } from "@jobpilot/db";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import AnswersPanel from "./AnswersPanel";

export const metadata = { title: "Answers" };

export const dynamic = "force-dynamic";

/** How far back the coverage report reads the audit trail. */
const COVERAGE_WINDOW_DAYS = 30;

export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; questionPattern?: string }>;
}) {
  const { userId } = await requireUser();
  const since = new Date(Date.now() - COVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [answers, stops, missing, params] = await Promise.all([
    listAnswers(userId),
    listNotifyStops({ userId, since }),
    listMissingAnswerKeys({ userId, since }),
    searchParams,
  ]);

  const coverage = buildAnswerCoverage({
    stops,
    missing,
    answeredKeys: answers.map((entry) => entry.key),
  });

  return (
    <div className="space-y-6" data-testid="answers-page">
      <div>
        <h1 className="text-xl font-semibold">Answer Bank</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Sensitive questions — salary, work authorization, disability, criminal
          history and demographics — are only ever answered from here. Anything
          missing stays with you rather than being guessed.
        </p>
      </div>

      <section className="card" data-testid="coverage-report">
        <h2 className="font-semibold">What stopped Auto-Pilot</h2>
        <p className="mt-1 text-sm text-neutral-600" data-testid="coverage-summary">
          {coverageSummary(coverage)} Last {COVERAGE_WINDOW_DAYS} days, from the
          audited stop notifications.
        </p>

        {coverage.groups.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="coverage-groups">
            {coverage.groups.map((group) => (
              <li
                key={group.code}
                className="border-t border-neutral-200 pt-2 text-sm"
                data-testid="coverage-group"
                data-code={group.code}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{group.code}</span>
                  <span className="text-neutral-600" data-testid="coverage-count">
                    {group.count}×
                  </span>
                </div>
                <p className="mt-1 text-neutral-700">
                  {group.note}{" "}
                  {group.href && (
                    <Link className="text-blue-700 underline" href={group.href}>
                      Go there
                    </Link>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        {coverage.suggestions.length > 0 && (
          <div className="mt-4" data-testid="coverage-suggestions">
            <h3 className="text-sm font-medium">Answers that would have prevented these</h3>
            <ul className="mt-2 space-y-2">
              {coverage.suggestions.map((suggestion) => (
                <li
                  key={suggestion.key}
                  className="border-t border-neutral-200 pt-2 text-sm"
                  data-testid="coverage-suggestion"
                  data-key={suggestion.key}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium" data-testid="coverage-suggestion-key">
                      {suggestion.key}
                    </span>
                    <span className="text-neutral-600">{suggestion.count}×</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    pattern: <code>{suggestion.questionPattern}</code>
                  </p>
                  <Link
                    className="mt-1 inline-block text-blue-700 underline"
                    href={suggestion.addHref}
                    data-testid="coverage-add"
                  >
                    Add this answer
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <AnswersPanel
        initial={answers}
        prefill={{ key: params.key, questionPattern: params.questionPattern }}
      />
    </div>
  );
}
