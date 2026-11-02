/** "2021-03 — 2023-12", "2021-03 — Present" or "" when undated. */
export function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  if (!end) return `${start ?? ""} — Present`;
  return `${start ?? ""} — ${end}`;
}
