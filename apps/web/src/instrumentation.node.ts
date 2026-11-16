/**
 * A deployment that kept the repository's throwaway secrets is stopped here
 * rather than serving sessions signed with a key that is in the git history (H4).
 *
 * 4.6: the same start also brings up the Auto-Pilot run consumer, so a queued run
 * has something to execute it in the app's own process instead of needing a
 * companion process to be running. The shared handler is the worker's, so the
 * stop checks, caps and audits are identical on both paths.
 *
 * A queue failure must not stop the app from booting: the Run route starts the
 * same consumer again (it is a no-op once it is up), and the enqueue decides what
 * the caller is told.
 */
export async function register(): Promise<void> {
  const { assertProductionConfig } = await import("@jobpilot/core");
  assertProductionConfig(process.env);

  const { ensureInProcessRunWorker } = await import("./lib/in-process-worker");
  await ensureInProcessRunWorker();
}
