export type ReportCategory = "Financial" | "Operations" | "Performance";

export type ReportColumnFormat =
  | "text"
  | "number"
  | "currency"
  | "percent"
  | "date";

export interface ReportColumn {
  key: string;
  label: string;
  format: ReportColumnFormat;
}

export type ReportCellValue = string | number | null;

export interface ReportSummaryCard {
  label: string;
  value: string;
  subtitle?: string;
}

export interface ReportNotice {
  tone: "info" | "warning";
  message: string;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
}

/**
 * The one generic shape every report generator produces, and the only
 * shape the preview UI and the three export engines (CSV/PDF/Excel) need
 * to know about - this is what keeps 13 reports x 3 export formats from
 * becoming 39 bespoke implementations. A report's own domain logic lives
 * entirely in services/reports/*.ts; nothing downstream of ReportResult
 * knows anything about invoices, expenses, or inventory.
 */
export interface ReportResult {
  id: string;
  title: string;
  category: ReportCategory;
  clinicName: string;
  currency: string;
  dateRangeLabel: string;
  generatedAt: string;

  summaryCards: ReportSummaryCard[];

  // The report's primary table.
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
  totalsRow?: Record<string, ReportCellValue>;

  // Secondary breakdown tables (e.g. "Revenue by Payment Method"),
  // rendered/exported after the primary table.
  sections?: ReportSection[];

  // Data-quality disclosures (e.g. "cost not configured for 30% of
  // revenue", "dentist revenue attribution is not available") - always
  // shown in the preview and included in every export, never silently
  // dropped.
  notices?: ReportNotice[];
}

export type ReportFilterField =
  | "dentist"
  | "treatment"
  | "paymentMethod"
  | "invoiceStatus"
  | "supplier"
  | "category"
  | "patient";

export interface ReportDefinition {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  filters: ReportFilterField[];
}

export interface ReportFilters {
  dentistId?: string;
  treatmentId?: string;
  paymentMethod?: string;
  invoiceStatus?: string;
  supplierId?: string;
  categoryId?: string;
  patientId?: string;
}

/**
 * A resolved date window a generator can query directly - the Reports
 * Center UI turns either a named range (via getDateRange) or an explicit
 * "Custom Range" pair into one of these before calling any generator, so
 * generators never need to know about range labels vs custom dates.
 */
export interface ReportPeriod {
  label: string;
  start: Date | null;
  end: Date | null;
}

export type ReportGenerator = (
  period: ReportPeriod,
  filters: ReportFilters
) => Promise<ReportResult>;
