import { listAnswers } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import AnswersPanel from "./AnswersPanel";

export const metadata = { title: "Answers" };

export const dynamic = "force-dynamic";

export default async function AnswersPage() {
  const { userId } = await requireUser();
  const answers = await listAnswers(userId);

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
      <AnswersPanel initial={answers} />
    </div>
  );
}