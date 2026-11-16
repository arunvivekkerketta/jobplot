/**
 * A deployment that kept the repository's throwaway secrets is stopped here
 * rather than serving sessions signed with a key that is in the git history (H4).
 */
export async function register(): Promise<void> {
  const { assertProductionConfig } = await import("@jobpilot/core");
  assertProductionConfig(process.env);
}
