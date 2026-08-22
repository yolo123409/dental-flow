import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "@/services/clinic";
import { assertPermission } from "@/services/authorization";

import { getDateRange } from "./dateRange";

export interface RevenueChartPoint {
  month: string;
  revenue: number;
  tax: number;
}

export type Granularity = "hour" | "day" | "month";

export function granularityFor(range: string): Granularity {
  if (range === "Today") return "hour";

  if (range === "7 Days" || range === "30 Days") return "day";

  return "month";
}

function bucketKey(
  date: Date,
  granularity: Granularity
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");

  if (granularity === "hour") return `${year}-${month}-${day}-${hour}`;

  if (granularity === "day") return `${year}-${month}-${day}`;

  return `${year}-${month}`;
}

function bucketLabel(
  date: Date,
  granularity: Granularity
): string {
  if (granularity === "hour") {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
    });
  }

  if (granularity === "day") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function nextBucket(
  date: Date,
  granularity: Granularity
): Date {
  const next = new Date(date);

  if (granularity === "hour") next.setHours(next.getHours() + 1);
  else if (granularity === "day") next.setDate(next.getDate() + 1);
  else next.setMonth(next.getMonth() + 1);

  return next;
}

/**
 * The single source of revenue-over-time data - used by both the
 * Analytics page's chart and the Dashboard's revenue widget. "Revenue"
 * means the same thing here as in getRevenueAnalytics: sum of `total`
 * for clinic_invoices with status 'Paid'.
 */
export async function getRevenueChartData(
  range: string
): Promise<RevenueChartPoint[]> {
  await assertPermission("analytics");

  const clinicId = await getCurrentClinicId();

  const { start, end } = getDateRange(range);

  const granularity = granularityFor(range);

  // Paged rather than a single unbounded fetch - "All Time" (and other
  // wide ranges) can plausibly return more than 1,000 Paid invoices for
  // an established clinic, which would otherwise silently drop
  // invoices from the chart with no error.
  let data: { total: number; tax: number; created_at: string }[];

  try {
    data = await fetchAllRows<{ total: number; tax: number; created_at: string }>(
      (from, to) => {
        let query = supabase
          .from("clinic_invoices")
          .select("total, tax, created_at")
          .eq("clinic_id", clinicId)
          .eq("status", "Paid");

        if (start) {
          query = query.gte("created_at", start.toISOString());
        }

        if (end) {
          query = query.lte("created_at", end.toISOString());
        }

        return query.range(from, to);
      }
    );
  } catch (error) {
    logError("[analytics] getRevenueChartData query failed:", error);

    throw error;
  }

  const revenueByBucket = new Map<
    string,
    { revenue: number; tax: number }
  >();

  for (const invoice of data ?? []) {
    const key = bucketKey(
      new Date(invoice.created_at),
      granularity
    );

    const existing = revenueByBucket.get(key) ?? {
      revenue: 0,
      tax: 0,
    };

    revenueByBucket.set(key, {
      revenue:
        existing.revenue +
        Number(invoice.total ?? 0),
      tax:
        existing.tax +
        Number(invoice.tax ?? 0),
    });
  }

  // Bounded ranges get every bucket zero-filled, so the trend line is
  // continuous instead of jumping straight from one data point to the
  // next with gaps skipped.
  if (start && end) {
    const points: RevenueChartPoint[] = [];

    for (
      let cursor = new Date(start);
      cursor <= end;
      cursor = nextBucket(cursor, granularity)
    ) {
      const bucket = revenueByBucket.get(
        bucketKey(cursor, granularity)
      );

      points.push({
        month: bucketLabel(cursor, granularity),
        revenue: bucket?.revenue ?? 0,
        tax: bucket?.tax ?? 0,
      });
    }

    return points;
  }

  // "All Time" has no fixed range to zero-fill from - only show buckets
  // that actually have revenue, in chronological order.
  return Array.from(revenueByBucket.keys())
    .sort()
    .map((key) => {
      const [year, month, day] = key.split("-").map(Number);

      const date = new Date(year, month - 1, day ?? 1);

      const bucket = revenueByBucket.get(key);

      return {
        month: bucketLabel(date, granularity),
        revenue: bucket?.revenue ?? 0,
        tax: bucket?.tax ?? 0,
      };
    });
}
