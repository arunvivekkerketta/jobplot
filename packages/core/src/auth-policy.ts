/**
 * Password attempt policy (M7). Kept in core so the rule is testable without a
 * request, a database or NextAuth.
 */
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MINUTES = 15;
/** Attempt rows are kept for a week, so the table cannot grow without bound. */
export const LOGIN_ATTEMPT_RETENTION_DAYS = 7;

export function isLoginLocked(recentFailures: number): boolean {
  return recentFailures >= LOGIN_FAILURE_LIMIT;
}
