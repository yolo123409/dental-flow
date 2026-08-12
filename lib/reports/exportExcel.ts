import ExcelJS from "exceljs";

import { ReportColumn, ReportResult, ReportSection } from "@/types/reports";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF175C4A" },
};

function numFmtFor(column: ReportColumn, currency: string): string | undefined {
  switch (column.format) {
    case "currency":
      return `"${currency}" #,##0`;
    case "percent":
      return '0.0"%"';
    case "number":
      return "#,##0";
    case "date":
      return "dd mmm yyyy";
    default:
      return undefined;
  }
}

function cellValueFor(
  value: string | number | null,
  column: ReportColumn
): string | number | Date | null {
  if (value === null || value === undefined) return null;

  if (
    (column.format === "currency" ||
      column.format === "percent" ||
      column.format === "number") &&
    typeof value !== "number"
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (column.format === "date" && typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }

  return value;
}

function writeTable(
  sheet: ExcelJS.Worksheet,
  columns: ReportColumn[],
  rows: Record<string, string | number | null>[],
  currency: string,
  totalsRow?: Record<string, string | number | null>
) {
  const headerRow = sheet.addRow(columns.map((column) => column.label));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  for (const row of rows) {
    const excelRow = sheet.addRow(
      columns.map((column) => cellValueFor(row[column.key] ?? null, column))
    );

    excelRow.eachCell((cell, colIndex) => {
      const format = numFmtFor(columns[colIndex - 1], currency);
      if (format) cell.numFmt = format;
    });
  }

  if (totalsRow) {
    const excelRow = sheet.addRow(
      columns.map((column) => cellValueFor(totalsRow[column.key] ?? null, column))
    );

    excelRow.eachCell((cell, colIndex) => {
      cell.font = { bold: true };
      const format = numFmtFor(columns[colIndex - 1], currency);
      if (format) cell.numFmt = format;
    });
  }

  sheet.columns.forEach((col, index) => {
    const headerLength = columns[index]?.label.length ?? 10;
    col.width = Math.max(headerLength + 4, 14);
  });
}

function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 2;

  while (taken.has(candidate)) {
    candidate = `${base.slice(0, 28)} ${suffix}`;
    suffix += 1;
  }

  taken.add(candidate);
  return candidate;
}

/**
 * A real, formatted .xlsx (currency/date/percent number formats, styled
 * headers, sized columns, a dedicated Summary sheet) via exceljs - not
 * raw JSON dumped into a sheet. Sheet 1 is always Summary, Sheet 2 is
 * always the report's primary Detailed Data table, and any `sections`
 * (secondary breakdowns) each get their own following sheet.
 */
export async function exportReportToExcel(report: ReportResult): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DentalFlow";
  workbook.created = new Date(report.generatedAt);

  const taken = new Set<string>();

  const summary = workbook.addWorksheet(sheetName("Summary", taken));
  summary.columns = [{ width: 28 }, { width: 30 }];

  summary.addRow([report.clinicName]).font = { bold: true, size: 14 };
  summary.addRow([report.title]).font = { bold: true, size: 12 };
  summary.addRow([`Period: ${report.dateRangeLabel}`]);
  summary.addRow([
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
  ]);
  summary.addRow([]);

  if (report.summaryCards.length > 0) {
    const header = summary.addRow(["Metric", "Value"]);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = HEADER_FILL;
    });

    for (const card of report.summaryCards) {
      summary.addRow([card.label, card.value]);
    }
  }

  if (report.notices && report.notices.length > 0) {
    summary.addRow([]);
    summary.addRow(["Notes"]).font = { bold: true };
    for (const notice of report.notices) {
      summary.addRow([notice.message]);
    }
  }

  const detail = workbook.addWorksheet(sheetName("Detailed Data", taken));
  writeTable(detail, report.columns, report.rows, report.currency, report.totalsRow);

  for (const section of (report.sections ?? []) as ReportSection[]) {
    const sheet = workbook.addWorksheet(sheetName(section.title, taken));
    writeTable(sheet, section.columns, section.rows, report.currency);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.title.replace(/\s+/g, "-")}-${report.generatedAt.slice(0, 10)}.xlsx`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
