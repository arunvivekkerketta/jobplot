-- A run claims an application before driving the browser, so the button and the
-- fifteen-minute cron can never work on the same posting at the same time.
ALTER TABLE "Application" ADD COLUMN "claimedAt" TIMESTAMP(3);