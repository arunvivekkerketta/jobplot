import { describe, expect, it } from "vitest";
import { startOfDayInZone } from "../src/time.js";

describe("gate 2.7: the daily cap starts at local midnight (M6)", () => {
  it("uses the user's zone, not the server's", () => {
    expect(startOfDayInZone(new Date("2026-11-16T20:00:00Z"), "Asia/Kolkata").toISOString()).toBe(
      "2026-11-16T18:30:00.000Z",
    );
    expect(startOfDayInZone(new Date("2026-11-16T12:00:00Z"), "UTC").toISOString()).toBe(
      "2026-11-16T00:00:00.000Z",
    );
    expect(
      startOfDayInZone(new Date("2026-11-16T07:00:00Z"), "America/New_York").toISOString(),
    ).toBe("2026-11-16T05:00:00.000Z");
  });
});
