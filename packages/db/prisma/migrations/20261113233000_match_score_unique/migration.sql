-- One score per (job, profile, algorithm version): recomputation updates in place
-- and a new algorithm version creates a new row instead of rewriting history.
CREATE UNIQUE INDEX "MatchScore_jobId_profileId_algoVersion_key"
    ON "MatchScore"("jobId", "profileId", "algoVersion");