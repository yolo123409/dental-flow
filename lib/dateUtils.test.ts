import { describe, expect, it } from "vitest";

import { localDateString } from "./dateUtils";

describe("localDateString (full-app audit fix C4)", () => {
  it("formats a Date's own local calendar date as YYYY-MM-DD", () => {
    expect(localDateString(new Date(2026, 7, 1))).toBe("2026-08-01");
    expect(localDateString(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(localDateString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("pads single-digit months and days", () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("never shifts the date via a UTC round-trip - the bug .toISOString().slice(0, 10) has for any timezone ahead of UTC", () => {
    // A Date constructed at local midnight must report that SAME calendar
    // day, regardless of what .toISOString() (which always normalizes to
    // UTC first) would say for a timezone ahead of UTC.
    const localMidnight = new Date(2026, 7, 1, 0, 0, 0, 0);
    expect(localDateString(localMidnight)).toBe("2026-08-01");

    // Confirmed directly for whatever timezone this test suite happens to
    // run in: localDateString must always agree with the Date's own
    // getFullYear/getMonth/getDate, never with a UTC-normalized value.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localDateString(now)).toBe(expected);
  });

  it("stays correct right up to and across a local midnight boundary", () => {
    expect(localDateString(new Date(2026, 7, 31, 23, 59, 59, 999))).toBe("2026-08-31");
    expect(localDateString(new Date(2026, 8, 1, 0, 0, 0, 0))).toBe("2026-09-01");
  });
});
