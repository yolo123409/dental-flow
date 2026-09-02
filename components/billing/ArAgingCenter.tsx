"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Clock, Users } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import SearchInput from "@/components/ui/SearchInput";
import RecordPaymentModal from "@/components/billing/RecordPaymentModal";

import {
  ArAgingBucketKey,
  ArOutstandingInvoice,
  ArSummary,
  getArSummary,
} from "@/services/billing";
import { getClinicSettings } from "@/services/settings";
import { recordReminderOpened } from "@/services/billingReminders";
import {
  buildBalanceReminderMessage,
  buildWhatsAppLink,
  normalizeKenyanPhone,
} from "@/lib/whatsapp";
import { getSafeErrorMessage, logError } from "@/lib/logError";

interface Props {
  currency: string;
  /** Bubbles up so the page can refresh its own Ready to Invoice / Invoiced
   * / Paid / Outstanding stat cards - this component owns its own AR data
   * and reloads it independently after a payment. */
  onPaymentRecorded: () => void;
}

type BucketFilter = "All" | ArAgingBucketKey;

const BUCKET_FILTERS: { key: BucketFilter; label: string }[] = [
  { key: "All", label: "All Outstanding" },
  { key: "0-30", label: "0–30 Days" },
  { key: "31-60", label: "31–60 Days" },
  { key: "61-90", label: "61–90 Days" },
  { key: "90+", label: "90+ Days" },
];

type SortMode = "age" | "balance";

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// ageDays is days PAST DUE (billing audit fix #2), floored at 0 - so 0
// means "not yet overdue" (could be due today or not due for weeks), not
// "issued today".
function formatAge(ageDays: number): string {
  if (ageDays === 0) return "Not yet due";
  if (ageDays === 1) return "1 day overdue";
  return `${ageDays} days overdue`;
}

export default function ArAgingCenter({ currency, onPaymentRecorded }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ArSummary | null>(null);

  const [bucketFilter, setBucketFilter] = useState<BucketFilter>("All");
  const [sortMode, setSortMode] = useState<SortMode>("age");
  const [search, setSearch] = useState("");

  const [paymentTarget, setPaymentTarget] =
    useState<ArOutstandingInvoice | null>(null);

  const [clinicInfo, setClinicInfo] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [data, settings] = await Promise.all([
        getArSummary(),
        getClinicSettings(),
      ]);

      setSummary(data);
      setClinicInfo({ name: settings.clinic_name ?? "", phone: settings.phone });
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load Accounts Receivable.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Billing audit fix #2: reuses the exact click-to-chat pattern already
  // built for appointment reminders (WhatsAppReminderModal) - opens a
  // prefilled WhatsApp chat, then logs only that the link was opened
  // (never that the patient actually received or read it).
  async function handleSendReminder(invoice: ArOutstandingInvoice) {
    const normalized = normalizeKenyanPhone(invoice.patientPhone);

    if (!normalized) {
      toast.error("This patient has no valid phone number on file.");
      return;
    }

    const message = buildBalanceReminderMessage({
      patientFirstName: invoice.patientName.split(" ")[0] || invoice.patientName,
      clinicName: clinicInfo?.name || "the clinic",
      invoiceNumber: invoice.invoiceNumber,
      balance: formatMoney(invoice.balance),
      dueDate: invoice.dueDate,
      clinicPhone: clinicInfo?.phone,
    });

    window.open(buildWhatsAppLink(normalized, message), "_blank", "noopener,noreferrer");

    try {
      await recordReminderOpened({
        patientId: invoice.patientId,
        invoiceId: invoice.invoiceId,
      });
    } catch (error) {
      // Non-blocking: the reminder was already opened for the patient -
      // failing to log that fact shouldn't look like the reminder failed.
      logError("[ArAgingCenter] Failed to record reminder opened:", error);
    }
  }

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    [currency]
  );

  const visibleInvoices = useMemo(() => {
    if (!summary) return [];

    const term = search.trim().toLowerCase();

    const filtered = summary.invoices.filter((invoice) => {
      if (bucketFilter !== "All" && invoice.bucket !== bucketFilter) return false;

      if (term) {
        const haystack =
          `${invoice.patientName} ${invoice.invoiceNumber}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });

    const sorted = [...filtered];

    if (sortMode === "age") {
      sorted.sort((a, b) => b.ageDays - a.ageDays);
    } else {
      sorted.sort((a, b) => b.balance - a.balance);
    }

    return sorted;
  }, [summary, bucketFilter, search, sortMode]);

  const multiInvoicePatients = useMemo(
    () => (summary?.patients ?? []).filter((patient) => patient.invoiceCount > 1),
    [summary]
  );

  async function handlePaymentSuccess() {
    setPaymentTarget(null);
    await load();
    onPaymentRecorded();
  }

  function handleExportCsv() {
    if (!summary || visibleInvoices.length === 0) return;

    const header = [
      "Patient",
      "Invoice",
      "Invoice Date",
      "Age (days)",
      "Treatment / Summary",
      "Total",
      "Paid",
      "Outstanding",
      "Status",
    ];

    const lines = [header.map(escapeCsvCell).join(",")];

    for (const invoice of visibleInvoices) {
      lines.push(
        [
          invoice.patientName,
          invoice.invoiceNumber,
          new Date(invoice.invoiceDate).toLocaleDateString(),
          String(invoice.ageDays),
          invoice.treatmentSummary,
          invoice.total.toFixed(2),
          invoice.amountPaid.toFixed(2),
          invoice.balance.toFixed(2),
          invoice.status,
        ]
          .map(escapeCsvCell)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `Accounts-Receivable-${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  if (loading || !summary) {
    return (
      <Card>
        <div className="py-12 text-center text-mineral">
          Loading Accounts Receivable...
        </div>
      </Card>
    );
  }

  const maxBucketAmount = Math.max(
    1,
    ...summary.buckets.map((bucket) => bucket.amount)
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-graphite">
          Accounts Receivable
        </h2>
        <p className="mt-1 text-sm text-mineral">
          Every currently outstanding invoice balance, aged from its invoice
          date. This is a live snapshot, not a date-filtered figure - it
          always reflects the current balance of every unpaid or partially
          paid invoice.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Outstanding"
          value={formatMoney(summary.totalOutstanding)}
          subtitle={`${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? "" : "s"}`}
        />
        <StatCard
          title="Patients With Balance"
          value={summary.patientCount}
          icon={<Users size={20} />}
        />
        <StatCard
          title="Oldest Outstanding"
          value={
            summary.oldestInvoice ? formatAge(summary.oldestInvoice.ageDays) : "—"
          }
          subtitle={summary.oldestInvoice?.invoiceNumber}
          icon={<Clock size={20} />}
        />
        <StatCard
          title="Largest Balance"
          value={
            summary.largestInvoice
              ? formatMoney(summary.largestInvoice.balance)
              : formatMoney(0)
          }
          subtitle={summary.largestInvoice?.invoiceNumber}
        />
      </div>

      {summary.invoiceCount === 0 ? (
        <Card>
          <EmptyState
            title="Nothing outstanding right now"
            description="Every invoice is fully paid. New balances will appear here as soon as an invoice is created or partially paid."
          />
        </Card>
      ) : (
        <>
          <Card title="Aging">
            <div className="space-y-3">
              {summary.buckets.map((bucket) => {
                const pct =
                  summary.totalOutstanding > 0
                    ? Math.round((bucket.amount / summary.totalOutstanding) * 100)
                    : 0;

                return (
                  <button
                    key={bucket.key}
                    onClick={() =>
                      setBucketFilter(
                        bucketFilter === bucket.key ? "All" : bucket.key
                      )
                    }
                    title={`${bucket.label}: ${formatMoney(bucket.amount)} across ${bucket.count} invoice${bucket.count === 1 ? "" : "s"} (${pct}% of total AR)`}
                    className={`w-full rounded-lg p-3 text-left transition ${
                      bucketFilter === bucket.key
                        ? "bg-sea-glass"
                        : "hover:bg-porcelain"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-graphite">
                        {bucket.label}{" "}
                        <span className="text-xs text-mineral">
                          ({bucket.count} invoice{bucket.count === 1 ? "" : "s"})
                        </span>
                      </span>
                      <span className="font-bold text-graphite">
                        {formatMoney(bucket.amount)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-porcelain">
                      <div
                        className="h-full rounded-full bg-eucalyptus motion-safe:transition-[width] motion-safe:duration-500"
                        style={{
                          width: `${Math.max(2, (bucket.amount / maxBucketAmount) * 100)}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {multiInvoicePatients.length > 0 && (
            <Card title="Needs Attention">
              <p className="-mt-2 mb-4 text-xs text-mineral">
                Patients with more than one outstanding invoice - often the
                easiest place to prioritize a collections conversation.
              </p>

              <div className="space-y-2">
                {multiInvoicePatients.slice(0, 8).map((patient) => (
                  <div
                    key={patient.patientId}
                    className="flex items-center justify-between rounded-lg border border-sea-glass p-3"
                  >
                    <div>
                      <Link
                        href={`/admin/patients/${patient.patientId}`}
                        className="font-medium text-eucalyptus hover:underline"
                      >
                        {patient.patientName}
                      </Link>
                      <p className="text-xs text-mineral">
                        {patient.invoiceCount} invoices · oldest{" "}
                        {formatAge(patient.oldestAgeDays)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-bold text-graphite">
                        {formatMoney(patient.outstanding)}
                      </span>
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => {
                          setBucketFilter("All");
                          setSearch(patient.patientName);
                        }}
                      >
                        View AR
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Outstanding Invoices">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {BUCKET_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setBucketFilter(filter.key)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      bucketFilter === filter.key
                        ? "bg-eucalyptus text-white"
                        : "border border-sea-glass bg-enamel hover:bg-porcelain"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full max-w-xs sm:w-56">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Search patient or invoice #..."
                  />
                </div>

                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                  aria-label="Sort outstanding invoices"
                >
                  <option value="age">Oldest First</option>
                  <option value="balance">Highest Balance First</option>
                </select>

                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={handleExportCsv}
                  disabled={visibleInvoices.length === 0}
                >
                  Export CSV
                </Button>
              </div>
            </div>

            {visibleInvoices.length === 0 ? (
              <EmptyState
                title="No outstanding invoices match"
                description="Try a different aging bucket or search term."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-sea-glass">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className="bg-porcelain">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Patient
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Invoice
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Age
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Treatment / Summary
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Total
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Paid
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Balance
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((invoice) => (
                      <tr
                        key={invoice.invoiceId}
                        className="border-t border-sea-glass"
                      >
                        <td className="px-4 py-4 font-medium text-graphite">
                          <Link
                            href={`/admin/patients/${invoice.patientId}`}
                            className="text-eucalyptus hover:underline"
                          >
                            {invoice.patientName}
                          </Link>
                        </td>
                        <td className="px-4 py-4">
                          <Link
                            href={`/admin/billing/${invoice.invoiceId}`}
                            className="font-medium text-eucalyptus hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                          <p className="text-xs text-mineral">
                            {new Date(invoice.invoiceDate).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-graphite">
                          {formatAge(invoice.ageDays)}
                        </td>
                        <td className="px-4 py-4 text-graphite">
                          {invoice.treatmentSummary}
                        </td>
                        <td className="px-4 py-4 text-right text-graphite">
                          {formatMoney(invoice.total)}
                        </td>
                        <td className="px-4 py-4 text-right text-graphite">
                          {formatMoney(invoice.amountPaid)}
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-graphite">
                          {formatMoney(invoice.balance)}
                        </td>
                        <td className="px-4 py-4">
                          <Badge
                            color={
                              invoice.status === "Partially Paid" ? "yellow" : "red"
                            }
                          >
                            {invoice.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {invoice.ageDays > 0 && (
                              <Button
                                variant="secondary"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => handleSendReminder(invoice)}
                              >
                                Send Reminder
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setPaymentTarget(invoice)}
                            >
                              Record Payment
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {paymentTarget && (
        <RecordPaymentModal
          invoiceId={paymentTarget.invoiceId}
          invoiceNumber={paymentTarget.invoiceNumber}
          patientName={paymentTarget.patientName}
          currency={currency}
          total={paymentTarget.total}
          amountPaid={paymentTarget.amountPaid}
          balance={paymentTarget.balance}
          invoicePaymentMethod={paymentTarget.paymentMethod}
          invoiceInsuranceProviderId={paymentTarget.insuranceProviderId}
          invoiceInsuranceProviderName={paymentTarget.insuranceProviderName}
          open={paymentTarget != null}
          onClose={() => setPaymentTarget(null)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
