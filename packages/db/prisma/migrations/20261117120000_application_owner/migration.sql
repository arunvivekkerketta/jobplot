-- An application belongs to the account that queued it. Every read and write on
-- this table is scoped by "userId", so one tenant can neither approve nor report
-- a result on another tenant's row.
ALTER TABLE "Application" ADD COLUMN "userId" TEXT;

-- Backfill 1: a row queued from a tailored version belongs to that profile's owner.
UPDATE "Application" a
SET "userId" = p."userId"
FROM "ResumeVersion" v
JOIN "Profile" p ON p."id" = v."profileId"
WHERE a."resumeVersionId" = v."id" AND a."userId" IS NULL;

-- Backfill 2: the rest predate owners. This stack has always run single-tenant
-- (one seeded administrator), so the oldest account is the honest owner of a row
-- created while there was nobody else to own it.
UPDATE "Application"
SET "userId" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
)
WHERE "userId" IS NULL;

-- Refuse rather than guess: with no account at all the rows cannot be attributed,
-- and deleting submission history to satisfy a NOT NULL would be worse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Application" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Application rows exist with no user to own them; create the owning account and re-run this migration.';
  END IF;
END $$;

ALTER TABLE "Application" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "One application per posting" was global; with owners it is per owner.
DROP INDEX "Application_jobId_key";
CREATE UNIQUE INDEX "Application_userId_jobId_key" ON "Application"("userId", "jobId");
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");
