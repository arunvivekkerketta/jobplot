/**
 * Start of the local day in a named time zone, as an absolute instant.
 *
 * Daily caps are a calendar concept ("ten applications today"), so the boundary
 * must follow the user's zone rather than the server's. The offset is derived
 * from Intl rather than a date library to keep this dependency-free.
 */
export function startOfDayInZone(now: Date, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+p.year!, +p.month! - 1, +p.day!) - offsetMs);
}
