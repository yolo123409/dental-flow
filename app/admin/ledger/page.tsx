"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  FileDown,
  FileSpreadsheet,
  FileText,
  Wallet,
  Receipt,
  CreditCard,
  Boxes,
  TrendingUp,
  TrendingDown,
  Scale,
} from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { getDateRange } from "@/services/analytics/dateRange";
import { localDateString } from "@/lib/dateUtils";
import { getClinicSettings } from "@/services/settings";
import { getPatientOptions } from "@/services/patients";
import { getSuppliers } from "@/services/suppliers";

import {
  getLedgerAccounts,
  getLedgerDashboardTotals,
  getLedgerTransactions,
  getReconciliationIssues,
} from "@/services/ledger";

import { exportReportToCsv } from "@/lib/reports/exportCsv";
import { exportReportToPdf } from "@/lib/reports/exportPdf";
import { exportReportToExcel } from "@/lib/reports/exportExcel";
import { ReportResult } from "@/types/reports";

import {
  LedgerAccount,
  LedgerDashboardTotals,
  LedgerReconciliationIssue,
  LedgerTransaction,
  LedgerTransactionType,
} from "@/types/ledger";

import ManualJournalEntryModal from "@/components/ledger/ManualJournalEntryModal";
import { getSafeErrorMessage } from "@/lib/logError";

const DATE_RANGES = [
  "Today",
  "Yesterday",
  "7 Days",
  "30 Days",
  "This Month",
  "Last Month",
  "This Year",
  "All Time",
];

const TRANSACTION_TYPES: LedgerTransactionType[] = [
  "Invoice",
  "Payment",
  "Expense",
  "InventoryReceipt",
  "InventoryConsumption",
  "InventoryReturn",
  "ManualJournal",
  "Reversal",
  "OpeningBalance",
];

const PAGE_SIZE = 25;

interface EntryRow {
  transactionId: string;
  date: string;
  reference: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
}

function LedgerPageContent() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("ledger_manage");

  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [dateRange, setDateRange] = useState("This Month");

  const [totals, setTotals] = useState<LedgerDashboardTotals | null>(null);
  const [issues, setIssues] = useState<LedgerReconciliationIssue[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [patients, setPatients] = useState<{ id: string; label: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[]>([]);

  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);

  const [accountFilter, setAccountFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [search, setSearch] = useState("");

  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | "csv" | null>(null);

  const period = useMemo(() => {
    if (dateRange === "All Time") return { start: null, end: null };
    return getDateRange(dateRange);
  }, [dateRange]);

  const loadSummary = useCallback(async () => {
    try {
      const [clinicSettings, dashboardTotals, issueRows, accountRows] = await Promise.all([
        getClinicSettings(),
        getLedgerDashboardTotals(period.start, period.end),
        getReconciliationIssues(),
        getLedgerAccounts(),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setTotals(dashboardTotals);
      setIssues(issueRows);
      setAccounts(accountRows);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load the ledger."));
    }
  }, [period]);

  const loadTransactions = useCallback(async () => {
    try {
      setLoading(true);

      const page = await getLedgerTransactions({
        startDate: period.start ? localDateString(period.start) : undefined,
        endDate: period.end ? localDateString(period.end) : undefined,
        accountId: accountFilter || undefined,
        transactionType: (typeFilter as LedgerTransactionType) || undefined,
        patientId: patientFilter || undefined,
        supplierId: supplierFilter || undefined,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset,
      });

      setTransactions(page.rows);
      setTotalCount(page.count);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load ledger transactions."));
    } finally {
      setLoading(false);
    }
  }, [period, accountFilter, typeFilter, patientFilter, supplierFilter, search, offset]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    getPatientOptions()
      .then((data) =>
        setPatients(data.map((p) => ({ id: p.id, label: `${p.first_name} ${p.last_name}` })))
      )
      .catch((error) => console.error(error));

    getSuppliers()
      .then((data) => setSuppliers(data.map((s) => ({ id: s.id, label: s.name }))))
      .catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [accountFilter, typeFilter, patientFilter, supplierFilter, search, dateRange]);

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    [currency]
  );

  const entryRows: EntryRow[] = useMemo(() => {
    const rows: EntryRow[] = [];

    for (const transaction of transactions) {
      const reference = transaction.reference_type
        ? `${transaction.reference_type}${transaction.reference_id ? "" : ""}`
        : transaction.transaction_type;

      for (const entry of transaction.clinic_ledger_entries ?? []) {
        rows.push({
          transactionId: transaction.id,
          date: transaction.transaction_date,
          reference,
          description: transaction.description,
          account: entry.clinic_ledger_accounts
            ? `${entry.clinic_ledger_accounts.code} ${entry.clinic_ledger_accounts.name}`
            : "—",
          debit: Number(entry.debit),
          credit: Number(entry.credit),
        });
      }
    }

    return rows;
  }, [transactions]);

  let runningBalance = 0;
  const rowsWithBalance = entryRows.map((row) => {
    runningBalance += row.debit - row.credit;
    return { ...row, balance: runningBalance };
  });

  const totalDebits = entryRows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredits = entryRows.reduce((sum, row) => sum + row.credit, 0);

  function buildReportResult(): ReportResult {
    return {
      id: "ledger",
      title: "Accounting Ledger",
      category: "Financial",
      clinicName: currency, // overwritten below once clinic name is available
      currency,
      dateRangeLabel: dateRange,
      generatedAt: new Date().toISOString(),
      summaryCards: [
        { label: "Total Debits", value: formatMoney(totalDebits) },
        { label: "Total Credits", value: formatMoney(totalCredits) },
        { label: "Net Movement", value: formatMoney(totalDebits - totalCredits) },
      ],
      columns: [
        { key: "date", label: "Date", format: "date" },
        { key: "reference", label: "Reference", format: "text" },
        { key: "description", label: "Description", format: "text" },
        { key: "account", label: "Account", format: "text" },
        { key: "debit", label: "Debit", format: "currency" },
        { key: "credit", label: "Credit", format: "currency" },
        { key: "balance", label: "Balance", format: "currency" },
      ],
      rows: rowsWithBalance,
    };
  }

  async function handleExport(format: "pdf" | "excel" | "csv") {
    try {
      setExporting(format);

      const clinicSettings = await getClinicSettings();
      const report = { ...buildReportResult(), clinicName: clinicSettings.clinic_name };

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

  const hasMore = offset + transactions.length < totalCount;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Accounting Ledger</h1>
          <p className="mt-2 text-slate-500">
            A chronological, auditable record of every financial transaction in your clinic.
          </p>
        </div>

        {canManage && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setJournalModalOpen(true)}>
              + Manual Journal Entry
            </Button>
            <Link href="/admin/settings/accounting">
              <Button variant="secondary">Chart of Accounts</Button>
            </Link>
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div className="status-scheduled flex items-start gap-3 rounded-lg px-6 py-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              {issues.length} ledger posting {issues.length === 1 ? "issue" : "issues"} need
              attention
            </p>
            <p className="mt-1 text-xs">
              The underlying financial records are unaffected - these are ledger entries that
              could not be posted automatically and need a manual journal entry to reconcile.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {issues.slice(0, 3).map((issue) => (
                <li key={issue.id}>{issue.issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {DATE_RANGES.map((range) => (
          <button
            key={range}
            onClick={() => setDateRange(range)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              dateRange === range
                ? "bg-eucalyptus text-white"
                : "border border-sea-glass bg-enamel hover:bg-porcelain"
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {totals && (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Cash & Bank"
            value={formatMoney(totals.cashAndBank)}
            icon={<Wallet size={20} />}
          />
          <StatCard
            title="Accounts Receivable"
            value={formatMoney(totals.accountsReceivable)}
            icon={<Receipt size={20} />}
          />
          <StatCard
            title="Accounts Payable"
            value={formatMoney(totals.accountsPayable)}
            icon={<CreditCard size={20} />}
          />
          <StatCard
            title="Inventory"
            value={formatMoney(totals.inventory)}
            icon={<Boxes size={20} />}
          />
          <StatCard
            title={`Revenue — ${dateRange}`}
            value={formatMoney(totals.revenue)}
            icon={<TrendingUp size={20} />}
          />
          <StatCard
            title={`Expenses — ${dateRange}`}
            value={formatMoney(totals.expenses)}
            icon={<TrendingDown size={20} />}
          />
          <StatCard
            title="Net Profit"
            value={formatMoney(totals.netProfit)}
            icon={<Scale size={20} />}
          />
        </div>
      )}

      <Card>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value="">All Accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value="">All Transaction Types</option>
              {TRANSACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <select
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value="">All Patients</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.label}
                </option>
              ))}
            </select>

            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Search description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => handleExport("pdf")}
            >
              <FileText size={16} />
              PDF
            </Button>
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => handleExport("excel")}
            >
              <FileSpreadsheet size={16} />
              Excel
            </Button>
            <Button
              variant="secondary"
              className="flex items-center gap-2 px-3 py-2 text-sm"
              disabled={exporting !== null}
              onClick={() => handleExport("csv")}
            >
              <FileDown size={16} />
              CSV
            </Button>
          </div>
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">Total Debits</p>
            <p className="mt-1 text-xl font-bold">{formatMoney(totalDebits)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">Total Credits</p>
            <p className="mt-1 text-xl font-bold">{formatMoney(totalCredits)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">Net Movement</p>
            <p className="mt-1 text-xl font-bold">{formatMoney(totalDebits - totalCredits)}</p>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner text="Loading ledger..." />
        ) : rowsWithBalance.length === 0 ? (
          <EmptyState
            title="No ledger transactions yet"
            description="Ledger entries are created automatically when invoices, payments, Money Out, and goods received notes occur."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Date</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Reference</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Description</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">Account</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold">Debit</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold">Credit</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold">Balance</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithBalance.map((row, index) => (
                    <tr key={`${row.transactionId}-${index}`} className="border-t border-slate-200">
                      <td className="px-6 py-4 text-slate-600">
                        {new Date(row.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{row.reference}</td>
                      <td className="px-6 py-4">{row.description}</td>
                      <td className="px-6 py-4">{row.account}</td>
                      <td className="px-6 py-4 text-right">
                        {row.debit > 0 ? formatMoney(row.debit) : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {row.credit > 0 ? formatMoney(row.credit) : "—"}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        {formatMoney(row.balance)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/admin/ledger/${row.transactionId}`}
                          className="text-sm font-medium text-eucalyptus hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalCount > PAGE_SIZE && (
              <div className="mt-6 flex items-center justify-between text-sm">
                <span className="text-mineral">
                  Showing {offset + 1}–{offset + transactions.length} of {totalCount} transactions
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="px-3 py-2 text-xs"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    className="px-3 py-2 text-xs"
                    disabled={!hasMore}
                    onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <ManualJournalEntryModal
        open={journalModalOpen}
        accounts={accounts}
        onClose={() => setJournalModalOpen(false)}
        onSaved={async () => {
          await Promise.all([loadSummary(), loadTransactions()]);
        }}
      />
    </div>
  );
}

export default function LedgerPage() {
  return (
    <PermissionGuard permission="ledger">
      <LedgerPageContent />
    </PermissionGuard>
  );
}
