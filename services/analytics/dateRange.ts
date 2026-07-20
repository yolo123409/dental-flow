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