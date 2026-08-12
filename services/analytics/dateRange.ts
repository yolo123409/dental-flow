export interface AnalyticsDateRange {
  start: Date | null;
  end: Date | null;
}

export function getDateRange(
  range: string
): AnalyticsDateRange {
  const end = new Date();

  switch (range) {
    case "Today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      return { start, end };
    }

    // Full previous calendar day (00:00:00 -> 23:59:59.999), not "24
    // hours ago -> now" - matches how every other named range here is a
    // calendar period, not a rolling window.
    case "Yesterday": {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);

      const yesterdayEnd = new Date(start);
      yesterdayEnd.setHours(23, 59, 59, 999);

      return { start, end: yesterdayEnd };
    }

    case "This Month": {
      return {
        start: new Date(
          end.getFullYear(),
          end.getMonth(),
          1
        ),
        end,
      };
    }

    // Full previous calendar month. Day 0 of the current month is the
    // last day of the previous month (same trick used elsewhere in this
    // codebase, e.g. services/expenses.ts#getMonthOverMonthExpenses).
    case "Last Month": {
      const start = new Date(
        end.getFullYear(),
        end.getMonth() - 1,
        1
      );

      const lastMonthEnd = new Date(
        end.getFullYear(),
        end.getMonth(),
        0
      );
      lastMonthEnd.setHours(23, 59, 59, 999);

      return { start, end: lastMonthEnd };
    }

    case "7 Days": {
      const start = new Date();
      start.setDate(start.getDate() - 7);

      return { start, end };
    }

    case "30 Days": {
      const start = new Date();
      start.setDate(start.getDate() - 30);

      return { start, end };
    }

    case "This Year": {
      return {
        start: new Date(end.getFullYear(), 0, 1),
        end,
      };
    }

    default:
      return {
        start: null,
        end: null,
      };
  }
}