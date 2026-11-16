-- 4.6: a Run becomes a queued job with a record of its own, so the click can
-- return before a browser starts and the page can still show the result later.
CREATE TABLE "AutopilotRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "limit" INTEGER,
    "jobIds" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "AutopilotRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutopilotRun_userId_requestedAt_idx" ON "AutopilotRun"("userId", "requestedAt");

ALTER TABLE "AutopilotRun" ADD CONSTRAINT "AutopilotRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
