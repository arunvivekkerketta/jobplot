import { z } from "zod";
import {
  MATCH_ALGO_VERSION,
  MATCH_EXPLANATION_TAG,
  meetsThreshold,
  scoreJob,
  type JsonResumeProfile,
  type MatchResult,
} from "@jobpilot/core";
import { AnthropicClient, buildMatchExplanation, type LLMClient } from "@jobpilot/llm";
import { prisma, saveJobEmbedding, saveMatchScore, writeAudit } from "@jobpilot/db";

const explanationOutput = z.object({
  explanation: z.string().min(1).max(400),
});

/** Built only when a key exists; otherwise the deterministic fallback is used. */
export function makeExplanationClient(): LLMClient | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new AnthropicClient({
    audit: async (entry) => {
      await writeAudit(entry);
    },
  });
}

export interface RecomputeOptions {
  userId: string;
  threshold: number;
  limit?: number;
  client?: LLMClient | null;
  asOf?: Date;
}

export interface RecomputeRow {
  jobId: string;
  score: number;
  aboveThreshold: boolean;
  explanation: string;
}

/**
 * Scores every recent posting for one profile, explains each score and persists
 * both the MatchScore row and the posting's embedding. Re-running is safe: the
 * unique key makes it an update (gate 5.5).
 */
export async function recomputeMatches(
  options: RecomputeOptions,
): Promise<RecomputeRow[] | null> {
  const profile = await prisma.profile.findUnique({ where: { userId: options.userId } });
  if (!profile) return null;

  const resume = profile.jsonResume as unknown as JsonResumeProfile;
  const client = options.client === undefined ? makeExplanationClient() : options.client;
  const jobs = await prisma.job.findMany({
    take: options.limit ?? 25,
    orderBy: { fetchedAt: "desc" },
    select: {
      id: true,
      title: true,
      company: true,
      descriptionText: true,
      location: true,
      remote: true,
      postedAt: true,
    },
  });

  const rows: RecomputeRow[] = [];

  for (const job of jobs) {
    const result: MatchResult = scoreJob(
      resume,
      {
        title: job.title,
        company: job.company,
        descriptionText: job.descriptionText,
        location: job.location,
        remote: job.remote,
        postedAt: job.postedAt?.toISOString() ?? null,
      },
      { asOf: options.asOf },
    );

    const request = buildMatchExplanation({
      job: {
        title: job.title,
        company: job.company,
        descriptionText: job.descriptionText,
      },
      profile: resume,
      result,
      ...(options.asOf ? { asOf: options.asOf } : {}),
    });
    let explanation = request.fallback;
    if (client) {
      try {
        const explained = await client.generateStructured({
          system: request.system,
          user: request.user,
          schema: explanationOutput,
          tag: MATCH_EXPLANATION_TAG,
        });
        explanation = explained.explanation;
      } catch (error) {
        // A model outage must not lose the deterministic score (I8 records it).
        await writeAudit({
          actor: "LLM",
          action: "match.explain.failed",
          entityType: "Job",
          entityId: job.id,
          payload: {
            message: error instanceof Error ? error.message : "unknown error",
            fallback: true,
          },
        });
      }
    } else {
      await writeAudit({
        actor: "SYSTEM",
        action: "match.explain.skipped",
        entityType: "Job",
        entityId: job.id,
        payload: { reason: "ANTHROPIC_API_KEY is not set; used the deterministic explanation" },
      });
    }

    await saveMatchScore({
      jobId: job.id,
      profileId: profile.id,
      score: result.score,
      breakdown: {
        ...result.breakdown,
        matched: result.matchedSkills,
        missing: result.missingSkills,
        yearsRequired: result.yearsRequired,
        candidateYears: result.candidateYears,
      },
      explanation,
      algoVersion: MATCH_ALGO_VERSION,
    });

    await saveJobEmbedding(job.id, `${job.title} ${job.company} ${job.descriptionText}`);

    rows.push({
      jobId: job.id,
      score: result.score,
      aboveThreshold: meetsThreshold(result.score, options.threshold),
      explanation,
    });
  }

  await writeAudit({
    actor: "SYSTEM",
    action: "match.recompute",
    entityType: "Profile",
    entityId: profile.id,
    payload: {
      scored: rows.length,
      threshold: options.threshold,
      aboveThreshold: rows.filter((row) => row.aboveThreshold).length,
      algoVersion: MATCH_ALGO_VERSION,
      explanationSource: client ? "llm" : "deterministic",
    },
  });

  return rows;
}