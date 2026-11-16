/**
 * "3 hours ago" next to the exact date. Relative text is what people scan for;
 * the exact timestamp stays available in the element's title attribute.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed)) return "unknown";

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(elapsed) < HOUR) {
    return formatter.format(-Math.round(elapsed / MINUTE), "minute");
  }
  if (Math.abs(elapsed) < DAY) {
    return formatter.format(-Math.round(elapsed / HOUR), "hour");
  }
  return formatter.format(-Math.round(elapsed / DAY), "day");
}

/** The exact local date and time, for the title attribute beside relative text. */
export function exactTime(iso: string | Date): string {
  const value = typeof iso === "string" ? new Date(iso) : iso;
  return value.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
