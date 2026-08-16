import { getDateRange } from "@/services/analytics/dateRange";

/**
 * Shared by every ledger-based financial report (Profit & Loss, Cash
 * Flow, ...) so period math - what "the previous equivalent period"
 * means for each named range, how a range is labeled - only lives in one
 * place and can never silently drift between reports.
 */
export const REPORT_RANGE_OPTIONS = [
  "This Month",
  "Last Month",
  "This Quarter",
  "This Year",
  "Last Year",
  "Custom Range",
];

export interface ResolvedPeriod {
  start: Date;
  end: Date;
  label: string;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function quarterLabel(quarterStart: Date): string {
  const quarter = Math.floor(quarterStart.getMonth() / 3) + 1;
  return `Q${quarter} ${quarterStart.getFullYear()}`;
}

export function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatRangeLabel(start: Date, end: Date): string {
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/**
 * Resolves a named range (or an explicit custom start/end pair) to
 * concrete dates - null when a Custom Range is selected but not yet
 * fully entered, which callers should treat as "nothing to load yet".
 */
export function resolveCurrentPeriod(
  rangeLabel: string,
  customStart: string,
  customEnd: string
): ResolvedPeriod | null {
  if (rangeLabel === "Custom Range") {
    if (!customStart || !customEnd) return null;

    const start = new Date(`${customStart}T00:00:00`);
    const end = new Date(`${customEnd}T23:59:59.999`);

    return { start, end, label: formatRangeLabel(start, end) };
  }

  const { start, end } = getDateRange(rangeLabel);
  if (!start || !end) return null;

  return { start, end, label: formatRangeLabel(start, end) };
}

/**
 * The "previous equivalent period" for each named range - a full prior
 * calendar month/quarter/year (matching this project's existing Monthly
 * Comparison report convention of comparing against a full prior
 * calendar period), or an equal-length window immediately before the
 * range for a Custom Range.
 */
export function getPreviousPeriod(rangeLabel: string, start: Date): ResolvedPeriod {
  switch (rangeLabel) {
    case "This Month": {
      const r = getDateRange("Last Month");
      return { start: r.start!, end: r.end!, label: monthLabel(r.start!) };
    }

    case "Last Month": {
      const s = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const e = new Date(start.getFullYear(), start.getMonth(), 0);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: monthLabel(s) };
    }

    case "This Quarter": {
      const s = new Date(start.getFullYear(), start.getMonth() - 3, 1);
      const e = new Date(start.getFullYear(), start.getMonth(), 0);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: quarterLabel(s) };
    }

    case "This Year": {
      const r = getDateRange("Last Year");
      return { start: r.start!, end: r.end!, label: String(r.start!.getFullYear()) };
    }

    case "Last Year": {
      const s = new Date(start.getFullYear() - 1, 0, 1);
      const e = new Date(start.getFullYear() - 1, 11, 31);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e, label: String(s.getFullYear()) };
    }

    default:
      return { start, end: start, label: "" };
  }
}

export function getPreviousCustomPeriod(start: Date, end: Date): ResolvedPeriod {
  const durationMs = end.getTime() - start.getTime();
  const e = new Date(start.getTime() - 1);
  const s = new Date(e.getTime() - durationMs);
  return { start: s, end: e, label: formatRangeLabel(s, e) };
}

/**
 * Resolves the correct "previous equivalent period" for whichever range
 * is currently selected - Custom Range gets an equal-length preceding
 * window, every named range gets its full prior calendar period.
 */
export function getPreviousPeriodFor(rangeLabel: string, current: ResolvedPeriod): ResolvedPeriod {
  return rangeLabel === "Custom Range"
    ? getPreviousCustomPeriod(current.start, current.end)
    : getPreviousPeriod(rangeLabel, current.start);
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
