"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getDateRange } from "@/services/analytics/dateRange";
import { REPORT_DEFINITIONS, generateReport } from "@/services/reports";
import { getDentistOptions } from "@/services/dentists";
import { getTreatments, ClinicTreatment } from "@/services/treatments";
import { getSuppliers } from "@/services/suppliers";
import { getExpenseCategories } from "@/services/expenseCategories";
import { getPatientOptions } from "@/services/patients";
import { getInventoryItems } from "@/services/inventory";

import { exportReportToCsv } from "@/lib/reports/exportCsv";
import { exportReportToPdf } from "@/lib/reports/exportPdf";
import { exportReportToExcel } from "@/lib/reports/exportExcel";
import { formatReportCell } from "@/lib/reports/format";
import { getSafeErrorMessage } from "@/lib/logError";

import {
  ReportCategory,
  ReportDefinition,
  ReportFilterField,
  ReportFilters,
  ReportPeriod,
  ReportResult,
} from "@/types/reports";

const CATEGORIES: ReportCategory[] = ["Financial", "Operations", "Performance"];

const DATE_RANGES = [
  "Today",
  "Yesterday",
  "7 Days",
  "30 Days",
  "This Month",
  "Last Month",
  "This Year",
  "Custom Range",
];

const PAYMENT_METHODS = [
  "Cash",
  "M-Pesa",
  "Bank Transfer",
  "Card",
  "Cheque",
  "Insurance",
  "Other",
];

const INVOICE_STATUSES = ["Unpaid", "Partially Paid", "Paid"];

interface FilterOption {
  id: string;
  label: string;
}

function ReportsCenterContent() {
  const [selectedReport, setSelectedReport] = useState<ReportDefinition | null>(null);

  const [dateRangeLabel, setDateRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [filters, setFilters] = useState<ReportFilters>({});

  const [dentistOptions, setDentistOptions] = useState<FilterOption[]>([]);
  const [treatmentOptions, setTreatmentOptions] = useState<ClinicTreatment[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<FilterOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<FilterOption[]>([]);
  const [patientOptions, setPatientOptions] = useState<FilterOption[]>([]);

  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | "csv" | null>(null);
  const [report, setReport] = useState<ReportResult | null>(null);

  // Filter option lists are loaded lazily per selected report, not all up
  // front - most reports only need one or two of these, and some (like
  // "category") mean different things depending on the report.
  useEffect(() => {
    if (!selectedReport) return;

    const fields = new Set(selectedReport.filters);

    if (fields.has("dentist") && dentistOptions.length === 0) {
      getDentistOptions()
        .then((data) =>
          setDentistOptions(data.map((d) => ({ id: d.id, label: d.full_name })))
        )
        .catch((error) => console.error(error));
    }

    if (fields.has("treatment") && treatmentOptions.length === 0) {
      getTreatments()
        .then(setTreatmentOptions)
        .catch((error) => console.error(error));
    }

    if (fields.has("supplier") && supplierOptions.length === 0) {
      getSuppliers()
        .then((data) => setSupplierOptions(data.map((s) => ({ id: s.id, label: s.name }))))
        .catch((error) => console.error(error));
    }

    if (fields.has("patient") && patientOptions.length === 0) {
      getPatientOptions()
        .then((data) =>
          setPatientOptions(
            data.map((p) => ({
              id: p.id,
              label: `${p.first_name} ${p.last_name}`,
            }))
          )
        )
        .catch((error) => console.error(error));
    }

    if (fields.has("category")) {
      if (selectedReport.id === "expense") {
        getExpenseCategories()
          .then((data) => setCategoryOptions(data.map((c) => ({ id: c.id, label: c.name }))))
          .catch((error) => console.error(error));
      } else if (selectedReport.id === "inventory-valuation") {
        getInventoryItems()
          .then((items) => {
            const names = Array.from(
              new Set(items.map((i) => i.category).filter((c): c is string => !!c))
            ).sort();
            setCategoryOptions(names.map((name) => ({ id: name, label: name })));
          })
          .catch((error) => console.error(error));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport]);

  function resolvePeriod(): ReportPeriod {
    if (dateRangeLabel === "Custom Range") {
      const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
      const end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : null;

      return { label: "Custom Range", start, end };
    }

    const { start, end } = getDateRange(dateRangeLabel);
    return { label: dateRangeLabel, start, end };
  }

  function selectReport(definition: ReportDefinition) {
    setSelectedReport(definition);
    setReport(null);
    setFilters({});
  }

  async function handleGenerate() {
    if (!selectedReport) return;

    if (dateRangeLabel === "Custom Range" && (!customStart || !customEnd)) {
      toast.error("Choose both a start and end date for a custom range.");
      return;
    }

    try {
      setGenerating(true);

      const result = await generateReport(selectedReport.id, resolvePeriod(), filters);

      setReport(result);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to generate report."));
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport(format: "pdf" | "excel" | "csv") {
    if (!report) return;

    try {
      setExporting(format);

      if (format === "pdf") exportReportToPdf(report);
      else if (format === "csv") exportReportToCsv(report);
      else await exportReportToExcel(report);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, `Failed to export ${format.toUpperCase()}.`)
      );
    } finally {
      setExporting(null);
    }
  }

  const filterFieldConfig: Record<
    ReportFilterField,
    { label: string; options: FilterOption[] } | null
  > = useMemo(
    () => ({
      dentist: { label: "Dentist", options: dentistOptions },
      treatment: {
        label: "Treatment",
        options: treatmentOptions.map((t) => ({ id: t.id, label: t.name })),
      },
      supplier: { label: "Supplier", options: supplierOptions },
      patient: { label: "Patient", options: patientOptions },
      category: { label: "Category", options: categoryOptions },
      paymentMethod: {
        label: "Payment Method",
        options: PAYMENT_METHODS.map((m) => ({ id: m, label: m })),
      },
      invoiceStatus: {
        label: "Invoice Status",
        options: INVOICE_STATUSES.map((s) => ({ id: s, label: s })),
      },
    }),
    [dentistOptions, treatmentOptions, supplierOptions, patientOptions, categoryOptions]
  );

  function filterKeyFor(field: ReportFilterField): keyof ReportFilters {
    switch (field) {
      case "dentist":
        return "dentistId";
      case "treatment":
        return "treatmentId";
      case "supplier":
        return "supplierId";
      case "patient":
        return "patientId";
      case "category":
        return "categoryId";
      case "paymentMethod":
        return "paymentMethod";
      case "invoiceStatus":
        return "invoiceStatus";
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Reports Center</h1>
        <p className="mt-2 text-slate-500">
          Generate business reports from your clinic&apos;s actual data and export
          them as PDF, Excel, or CSV.
        </p>
      </div>

      {!selectedReport ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {CATEGORIES.map((category) => (
            <Card key={category} title={category}>
              <div className="space-y-2">
                {REPORT_DEFINITIONS.filter((def) => def.category === category).map(
                  (def) => (
                    <button
                      key={def.id}
                      onClick={() => selectReport(def)}
                      className="w-full rounded-lg border border-sea-glass bg-enamel p-4 text-left transition hover:border-eucalyptus hover:bg-porcelain"
                    >
                      <p className="font-semibold text-graphite">{def.name}</p>
                      <p className="mt-1 text-xs text-mineral">{def.description}</p>
                    </button>
                  )
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedReport(null)}
            className="text-sm font-medium text-eucalyptus hover:underline"
          >
            ← Choose a different report
          </button>

          <Card title={selectedReport.name}>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-mineral">
                  Date Range
                </p>
                <div className="flex flex-wrap gap-2">
                  {DATE_RANGES.map((range) => (
                    <button
                      key={range}
                      onClick={() => setDateRangeLabel(range)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        dateRangeLabel === range
                          ? "bg-eucalyptus text-white"
                          : "border border-sea-glass bg-enamel hover:bg-porcelain"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>

                {dateRangeLabel === "Custom Range" && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                    />
                    <span className="text-sm text-mineral">to</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {selectedReport.filters.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-mineral">
                    Filters
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {selectedReport.filters.map((field) => {
                      const config = filterFieldConfig[field];
                      if (!config) return null;

                      const key = filterKeyFor(field);

                      return (
                        <select
                          key={field}
                          value={(filters[key] as string) ?? ""}
                          onChange={(e) =>
                            setFilters((prev) => ({
                              ...prev,
                              [key]: e.target.value || undefined,
                            }))
                          }
                          className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                        >
                          <option value="">All {config.label}s</option>
                          {config.options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          </Card>

          {generating && <LoadingSpinner text="Generating report..." />}

          {report && !generating && (
            <ReportPreview
              report={report}
              exporting={exporting}
              onExport={handleExport}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ReportPreview({
  report,
  exporting,
  onExport,
}: {
  report: ReportResult;
  exporting: "pdf" | "excel" | "csv" | null;
  onExport: (format: "pdf" | "excel" | "csv") => void;
}) {
  return (
    <Card>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sea-glass pb-4">
          <div>
            <p className="text-sm text-mineral">{report.clinicName}</p>
            <h2 className="font-display text-2xl font-bold">{report.title}</h2>
            <p className="mt-1 text-sm text-mineral">
              {report.dateRangeLabel} · Generated{" "}
              {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => onExport("pdf")}
            >
              <FileText size={16} />
              {exporting === "pdf" ? "Exporting..." : "PDF"}
            </Button>
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => onExport("excel")}
            >
              <FileSpreadsheet size={16} />
              {exporting === "excel" ? "Exporting..." : "Excel"}
            </Button>
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => onExport("csv")}
            >
              <FileDown size={16} />
              {exporting === "csv" ? "Exporting..." : "CSV"}
            </Button>
          </div>
        </div>

        {report.notices && report.notices.length > 0 && (
          <div className="space-y-2">
            {report.notices.map((notice, index) => (
              <div
                key={index}
                className={`rounded-lg px-4 py-3 text-sm ${
                  notice.tone === "warning"
                    ? "status-scheduled"
                    : "bg-porcelain text-mineral"
                }`}
              >
                {notice.message}
              </div>
            ))}
          </div>
        )}

        {report.summaryCards.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {report.summaryCards.map((card) => (
              <StatCard key={card.label} title={card.label} value={card.value} subtitle={card.subtitle} />
            ))}
          </div>
        )}

        <ReportTable
          columns={report.columns}
          rows={report.rows}
          totalsRow={report.totalsRow}
          currency={report.currency}
        />

        {(report.sections ?? []).map((section) => (
          <div key={section.title}>
            <h3 className="mb-3 font-display text-lg font-bold">{section.title}</h3>
            <ReportTable
              columns={section.columns}
              rows={section.rows}
              currency={report.currency}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReportTable({
  columns,
  rows,
  totalsRow,
  currency,
}: {
  columns: ReportResult["columns"];
  rows: ReportResult["rows"];
  totalsRow?: ReportResult["totalsRow"];
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-sea-glass py-8 text-center text-sm text-mineral">
        No data for this report in the selected period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-full">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-6 py-4 text-sm font-semibold ${
                  column.format === "text" || column.format === "date"
                    ? "text-left"
                    : "text-right"
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-slate-200">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-6 py-4 ${
                    column.format === "text" || column.format === "date"
                      ? "text-left"
                      : "text-right"
                  }`}
                >
                  {formatReportCell(row[column.key] ?? null, column.format, currency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalsRow && (
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-6 py-4 ${
                    column.format === "text" || column.format === "date"
                      ? "text-left"
                      : "text-right"
                  }`}
                >
                  {formatReportCell(totalsRow[column.key] ?? null, column.format, currency)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function ReportsCenterPage() {
  return (
    <PermissionGuard permission="analytics">
      <ReportsCenterContent />
    </PermissionGuard>
  );
}
