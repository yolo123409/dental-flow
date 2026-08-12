import { ReportResult } from "@/types/reports";
import { formatReportCell } from "./format";

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function tableToCsvRows(
  columns: ReportResult["columns"],
  rows: ReportResult["rows"],
  currency: string
): string[] {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");

  const body = rows.map((row) =>
    columns
      .map((column) =>
        escapeCsvCell(
          formatReportCell(row[column.key] ?? null, column.format, currency)
        )
      )
      .join(",")
  );

  return [header, ...body];
}

/**
 * A clean, spreadsheet-ready CSV - column headers, one row per record,
 * formatted dates/numbers via the same formatReportCell every other
 * surface uses, no UI chrome. Summary cards and notices are included as
 * a small header block above the table (their own text, not injected
 * into the data rows), since a CSV has no separate "cover page" the way
 * PDF/Excel do.
 */
export function exportReportToCsv(report: ReportResult): void {
  const lines: string[] = [];

  lines.push(escapeCsvCell(report.title));
  lines.push(escapeCsvCell(`${report.clinicName} · ${report.dateRangeLabel}`));
  lines.push(escapeCsvCell(`Generated ${new Date(report.generatedAt).toLocaleString()}`));
  lines.push("");

  if (report.summaryCards.length > 0) {
    lines.push(
      report.summaryCards.map((card) => escapeCsvCell(card.label)).join(",")
    );
    lines.push(
      report.summaryCards.map((card) => escapeCsvCell(card.value)).join(",")
    );
    lines.push("");
  }

  lines.push(
    ...tableToCsvRows(report.columns, report.rows, report.currency)
  );

  if (report.totalsRow) {
    lines.push(
      report.columns
        .map((column) =>
          escapeCsvCell(
            formatReportCell(
              report.totalsRow?.[column.key] ?? null,
              column.format,
              report.currency
            )
          )
        )
        .join(",")
    );
  }

  for (const section of report.sections ?? []) {
    lines.push("");
    lines.push(escapeCsvCell(section.title));
    lines.push(
      ...tableToCsvRows(section.columns, section.rows, report.currency)
    );
  }

  if (report.notices && report.notices.length > 0) {
    lines.push("");
    lines.push(escapeCsvCell("Notes"));
    for (const notice of report.notices) {
      lines.push(escapeCsvCell(notice.message));
    }
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.title.replace(/\s+/g, "-")}-${report.generatedAt.slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
