import { ReportCellValue, ReportColumnFormat } from "@/types/reports";

/**
 * Single formatting function shared by the preview UI and all three
 * export engines, so a number never renders differently in the browser
 * preview than it does in the PDF/Excel/CSV a user downloads from it.
 */
export function formatReportCell(
  value: ReportCellValue,
  format: ReportColumnFormat,
  currency: string
): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    // Defends against NaN/Infinity ever reaching a user-visible surface,
    // per the spec's explicit "never display NaN/Infinity" requirement -
    // every generator is expected to already guard its own division, this
    // is the last line of defense.
    return "—";
  }

  switch (format) {
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value));

    case "percent":
      return `${Number(value).toFixed(1)}%`;

    case "number":
      return new Intl.NumberFormat().format(Number(value));

    case "date":
      if (typeof value !== "string" || !value) return "—";
      return new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

    case "text":
    default:
      return String(value);
  }
}

export function formatDateRangeLabel(
  label: string,
  start: Date | null,
  end: Date | null
): string {
  if (label !== "Custom Range" && (!start || !end)) {
    return label;
  }

  if (!start || !end) return label;

  const fmt = (date: Date) =>
    date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return `${fmt(start)} — ${fmt(end)}`;
}
