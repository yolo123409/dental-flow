"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import SearchInput from "@/components/ui/SearchInput";
import ChargeDetailModal from "@/components/billing/ChargeDetailModal";
import InvoicePreviewModal from "@/components/billing/InvoicePreviewModal";
import RecordPaymentModal from "@/components/billing/RecordPaymentModal";
import ArAgingCenter from "@/components/billing/ArAgingCenter";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  ClinicChargeWithDetails,
  getCharges,
  getInvoiceBalanceTotals,
  getOutstandingInvoiceBalance,
} from "@/services/billing";
import { getTreatmentsForTooth } from "@/services/treatmentTeeth";
import { TreatmentPlanItem } from "@/types/treatmentPlan";

import {
  ClinicSettings,
  getClinicSettings,
} from "@/services/settings";
import { getSafeErrorMessage } from "@/lib/logError";

// Pending charges are a self-clearing work queue (they leave it the
// moment they're invoiced), never an ever-growing history - so this is a
// generous ceiling, not real pagination, matching the existing rationale
// documented on services/billing.ts#getCharges().
const PENDING_FETCH_SIZE = 10000;

const BROWSE_PAGE_SIZE = 50;

const SEARCH_DEBOUNCE_MS = 300;

type QuickFilter =
  | "Pending"
  | "All"
  | "Invoiced"
  | "Outstanding"
  | "Paid"
  | "Legacy";

// Phase J section 14: "Outstanding"/"Paid" describe an INVOICE's balance
// or status, never a clinic_charges row - so these two filters resolve to
// ChargeFilters.invoiceStatus (a filter on the linked invoice), not to
// clinic_charges.status the way "Invoiced"/"Legacy" do.
const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "Pending", label: "Ready to Invoice" },
  { key: "All", label: "All" },
  { key: "Invoiced", label: "Invoiced" },
  { key: "Outstanding", label: "Outstanding" },
  { key: "Paid", label: "Paid" },
  { key: "Legacy", label: "Legacy" },
];

const DATE_RANGES = ["All Time", "Today", "This Week", "This Month"] as const;

type DateRange = (typeof DATE_RANGES)[number];

function dateRangeStart(range: DateRange): string | undefined {
  const now = new Date();

  if (range === "Today") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).toISOString();
  }

  if (range === "This Week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;

    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - diffToMonday
    ).toISOString();
  }

  if (range === "This Month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  return undefined;
}

function chargeTeeth(charge: ClinicChargeWithDetails): number[] {
  const item = charge.treatment_plan_items;

  if (item) {
    if (item.treatment_teeth && item.treatment_teeth.length > 0) {
      return [...item.treatment_teeth]
        .map((row) => row.tooth_number)
        .sort((a, b) => a - b);
    }

    return item.tooth_number != null ? [item.tooth_number] : [];
  }

  return charge.tooth_number != null ? [charge.tooth_number] : [];
}

function BillingPageContent() {
  const [loading, setLoading] = useState(true);

  // Ready to Invoice - unbounded (see PENDING_FETCH_SIZE above), drives
  // both the "Ready to Invoice" workflow and its summary card.
  const [pendingCharges, setPendingCharges] = useState<
    ClinicChargeWithDetails[]
  >([]);

  const [selected, setSelected] = useState<string[]>([]);

  const [balanceTotals, setBalanceTotals] = useState({
    total: 0,
    paid: 0,
    outstanding: 0,
  });

  // Phase O: the "Outstanding" stat card below deliberately does NOT use
  // balanceTotals.outstanding - see the loadSummary comment.
  const [outstandingBalance, setOutstandingBalance] = useState(0);

  const [currency, setCurrency] = useState("KES");

  const [clinicSettings, setClinicSettings] =
    useState<ClinicSettings | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);

  const [detailCharge, setDetailCharge] =
    useState<ClinicChargeWithDetails | null>(null);

  // Phase J section 18: a direct "Record Payment" action on a browse-table
  // row, without requiring a detour through the detail modal first.
  const [paymentTarget, setPaymentTarget] =
    useState<ClinicChargeWithDetails | null>(null);

  const [activeFilter, setActiveFilter] = useState<QuickFilter>("Pending");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const [dateRange, setDateRange] = useState<DateRange>("All Time");

  const [browseRows, setBrowseRows] = useState<ClinicChargeWithDetails[]>([]);
  const [browseCount, setBrowseCount] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Phase G section 12 / Phase F: refines the heuristic now that
  // clinic_charges.treatment_plan_item_id (migration 0079) gives an exact
  // answer instead of a guess. A CANONICAL charge (treatment_plan_item_id
  // set) already knows exactly which Treatment created it - there is
  // nothing ambiguous to warn about. Only a LEGACY charge (still
  // unlinked) can be ambiguous, and even then only when its treatment
  // NAME matches an active canonical Treatment on the same tooth.
  const [duplicateWarnings, setDuplicateWarnings] = useState<
    Record<string, string>
  >({});

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);

      const [pending, totals, outstanding, settingsResult] = await Promise.all([
        getCharges(1, PENDING_FETCH_SIZE, { status: "Pending" }),
        getInvoiceBalanceTotals(),
        getOutstandingInvoiceBalance(),
        getClinicSettings(),
      ]);

      setPendingCharges(pending.rows);
      setBalanceTotals(totals);
      setOutstandingBalance(outstanding);
      setCurrency(settingsResult.currency || "KES");
      setClinicSettings(settingsResult);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load billing summary.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const legacyWithTooth = pendingCharges.filter(
        (charge) =>
          charge.treatment_plan_item_id == null &&
          charge.tooth_number != null
      );

      const uniqueLookups = new Map<
        string,
        { patientId: string; tooth: number }
      >();

      for (const charge of legacyWithTooth) {
        const key = `${charge.patient_id}:${charge.tooth_number}`;

        if (!uniqueLookups.has(key)) {
          uniqueLookups.set(key, {
            patientId: charge.patient_id,
            tooth: charge.tooth_number as number,
          });
        }
      }

      const results = await Promise.all(
        [...uniqueLookups.entries()].map(async ([key, { patientId, tooth }]) => {
          try {
            const items = await getTreatmentsForTooth(patientId, tooth);

            return [
              key,
              items.filter((item) => item.status !== "Cancelled"),
            ] as [string, TreatmentPlanItem[]];
          } catch {
            return [key, []] as [string, TreatmentPlanItem[]];
          }
        })
      );

      if (cancelled) return;

      const activeByKey = new Map(results);
      const next: Record<string, string> = {};

      for (const charge of legacyWithTooth) {
        const key = `${charge.patient_id}:${charge.tooth_number}`;
        const active = activeByKey.get(key) ?? [];

        const matchingName = active.find(
          (item) =>
            item.procedure.trim().toLowerCase() ===
            charge.treatment_name.trim().toLowerCase()
        );

        if (matchingName) {
          next[charge.id] =
            `This looks like the same treatment as an existing Treatment Plan entry: "${matchingName.procedure}" (Tooth ${charge.tooth_number}) - check this isn't a duplicate before invoicing.`;
        }
      }

      setDuplicateWarnings(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingCharges]);

  function handleSearchChange(value: string) {
    setSearch(value);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setBrowsePage(1);
      setDebouncedSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const loadBrowse = useCallback(async () => {
    try {
      setBrowseLoading(true);

      const { rows, count } = await getCharges(
        browsePage,
        BROWSE_PAGE_SIZE,
        {
          status: activeFilter === "Invoiced" ? "Invoiced" : undefined,
          source: activeFilter === "Legacy" ? "legacy" : undefined,
          invoiceStatus:
            activeFilter === "Outstanding"
              ? "Outstanding"
              : activeFilter === "Paid"
                ? "Paid"
                : undefined,
          search: debouncedSearch || undefined,
          dateFrom: dateRangeStart(dateRange),
        }
      );

      setBrowseRows(rows);
      setBrowseCount(count);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load charges."));
    } finally {
      setBrowseLoading(false);
    }
  }, [browsePage, activeFilter, debouncedSearch, dateRange]);

  useEffect(() => {
    // Phase K: "Outstanding" is now rendered by ArAgingCenter (invoice-
    // level AR), which loads its own data - the charge-level browse table
    // is neither shown nor needed in that state.
    if (activeFilter === "Pending" || activeFilter === "Outstanding") return;

    loadBrowse();
  }, [activeFilter, loadBrowse]);

  function handleFilterChange(filter: QuickFilter) {
    setActiveFilter(filter);
    setBrowsePage(1);
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  function toggleCharge(chargeId: string) {
    setSelected((current) =>
      current.includes(chargeId)
        ? current.filter((id) => id !== chargeId)
        : [...current, chargeId]
    );
  }

  const selectedCharges = useMemo(() => {
    return pendingCharges.filter((charge) => selected.includes(charge.id));
  }, [pendingCharges, selected]);

  const readyToInvoiceTotal = useMemo(
    () => pendingCharges.reduce((sum, c) => sum + Number(c.amount), 0),
    [pendingCharges]
  );

  const selectedPatientName = useMemo(() => {
    const first = selectedCharges[0]?.patients;

    return first ? `${first.first_name} ${first.last_name}` : "-";
  }, [selectedCharges]);

  async function handleInvoiceCreated() {
    setSelected([]);
    await loadSummary();

    if (activeFilter !== "Pending") {
      await loadBrowse();
    }
  }

  // Phase J section 18/21/22: after a payment, refresh the summary cards
  // (Paid/Outstanding change) and the browse table if visible - but never
  // close the detail modal here. ChargeDetailModal already refetches and
  // shows the updated charge itself (its own refreshedCharge state); if
  // this cleared detailCharge too, the panel would just close instead of
  // updating in place, defeating that design.
  async function handlePaymentRecorded() {
    setPaymentTarget(null);
    await loadSummary();

    if (activeFilter !== "Pending" && activeFilter !== "Outstanding") {
      await loadBrowse();
    }
  }

  const browseTotalPages = Math.max(
    1,
    Math.ceil(browseCount / BROWSE_PAGE_SIZE)
  );

  return (
    <div className="space-y-8">
      {/* Header */}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Billing</h1>
          <p className="mt-2 text-mineral">
            The financial lifecycle from Treatment to payment, in one
            place.
          </p>
        </div>

        <Link
          href="/admin/billing/invoices"
          className="rounded-xl bg-eucalyptus px-5 py-3 font-semibold text-white transition hover:bg-deep-eucalyptus"
        >
          View Invoices
        </Link>
      </div>

      {/* Summary cards - Phase I section 3/28. Each number's exact
          definition:
          READY TO INVOICE: sum(clinic_charges.amount) where status =
            'Pending' (legacy and canonical together).
          INVOICED: sum(clinic_invoices.total) across every invoice ever
            created (get_invoice_balance_totals RPC).
          PAID: sum(clinic_invoices.amount_paid) - kept exactly equal to
            recorded clinic_payments by recordPayment() (services/billing.ts).
          OUTSTANDING (Phase O): sum(balance) across invoices where
            balance > 0 (get_outstanding_invoice_balance RPC, migration
            0082) - deliberately NOT (INVOICED - PAID), which nets an
            overpaid invoice's negative balance against every other
            invoice's positive balance and silently understates what's
            actually owed. This is the same canonical Outstanding AR
            figure the Accounts Receivable and Financial Overview pages
            show. */}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Ready to Invoice"
          value={formatCurrency(readyToInvoiceTotal)}
          subtitle={`${pendingCharges.length} charge${pendingCharges.length === 1 ? "" : "s"}`}
        />

        <StatCard
          title="Invoiced"
          value={formatCurrency(balanceTotals.total)}
        />

        <StatCard
          title="Paid"
          value={formatCurrency(balanceTotals.paid)}
        />

        <StatCard
          title="Outstanding"
          value={formatCurrency(outstandingBalance)}
        />
      </div>

      {/* Quick filters */}

      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => handleFilterChange(filter.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeFilter === filter.key
                ? "bg-eucalyptus text-white"
                : "border border-sea-glass bg-enamel hover:bg-porcelain"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {activeFilter === "Pending" ? (
        <div className="grid gap-8 lg:grid-cols-3">
          <Card title="Ready to Invoice" className="lg:col-span-2">
            {loading ? (
              <div className="py-12 text-center text-mineral">
                Loading...
              </div>
            ) : pendingCharges.length === 0 ? (
              <EmptyState
                title="No charges ready to invoice."
                description="Pending charges from Treatments and Tooth Details will appear here as soon as they're created."
              />
            ) : (
              <div className="space-y-3">
                {pendingCharges.map((charge) => {
                  const teeth = chargeTeeth(charge);
                  const item = charge.treatment_plan_items;
                  const patientName = charge.patients
                    ? `${charge.patients.first_name} ${charge.patients.last_name}`
                    : "Unknown patient";

                  return (
                    <div
                      key={charge.id}
                      className="rounded-xl border border-sea-glass transition hover:bg-porcelain"
                    >
                      <label className="flex cursor-pointer items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <input
                            type="checkbox"
                            checked={selected.includes(charge.id)}
                            onChange={() => toggleCharge(charge.id)}
                          />

                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-graphite">
                                {charge.treatment_name}
                              </p>

                              {charge.treatment_plan_item_id != null ? (
                                <Badge color="blue">Treatment Plan</Badge>
                              ) : (
                                <Badge color="gray">
                                  Legacy Tooth Charge
                                </Badge>
                              )}
                            </div>

                            <p className="text-sm text-mineral">
                              {patientName} ·{" "}
                              {teeth.length === 0
                                ? "No tooth association"
                                : `${teeth.length === 1 ? "Tooth" : "Teeth"} ${teeth.join(" · ")}`}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="font-bold text-graphite">
                            {item && item.quantity > 1
                              ? `${formatCurrency(Number(charge.amount) / item.quantity)} × ${item.quantity}`
                              : formatCurrency(Number(charge.amount))}
                          </p>

                          {item && item.quantity > 1 && (
                            <p className="text-xs text-mineral">
                              = {formatCurrency(Number(charge.amount))}
                            </p>
                          )}
                        </div>
                      </label>

                      <div className="flex items-center justify-between border-t border-sea-glass px-4 py-2">
                        {charge.patients && (
                          <Link
                            href={`/admin/patients/${charge.patients.id}`}
                            className="text-xs font-semibold text-eucalyptus hover:underline"
                          >
                            View Patient
                          </Link>
                        )}

                        {item ? (
                          <Link
                            href={`/admin/patients/${charge.patient_id}?tab=Treatment+Plans&plan=${item.treatment_plan_id}`}
                            className="text-xs font-semibold text-eucalyptus hover:underline"
                          >
                            View Treatment
                          </Link>
                        ) : (
                          <span />
                        )}
                      </div>

                      {duplicateWarnings[charge.id] && (
                        <p className="flex items-start gap-1.5 border-t border-sea-glass bg-pale-ochre px-4 py-2 text-xs font-medium text-ochre-ink">
                          <AlertTriangle
                            size={13}
                            className="mt-0.5 shrink-0"
                          />
                          {duplicateWarnings[charge.id]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Invoice Summary">
            <div className="space-y-5">
              <div className="flex justify-between">
                <span>Selected</span>
                <span className="font-semibold">
                  {selectedCharges.length}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Amount</span>
                <span className="font-semibold">
                  {formatCurrency(
                    selectedCharges.reduce(
                      (sum, c) => sum + Number(c.amount),
                      0
                    )
                  )}
                </span>
              </div>

              <p className="text-xs text-mineral">
                Review the full breakdown - subtotal, tax, and total -
                before the invoice is created.
              </p>

              <Button
                className="w-full"
                disabled={selectedCharges.length === 0}
                onClick={() => setPreviewOpen(true)}
              >
                Review & Create Invoice
              </Button>
            </div>
          </Card>
        </div>
      ) : activeFilter === "Outstanding" ? (
        <ArAgingCenter currency={currency} onPaymentRecorded={loadSummary} />
      ) : (
        <Card>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-sm flex-1">
              <SearchInput
                value={search}
                onChange={handleSearchChange}
                placeholder="Search patient, treatment, or invoice #..."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {DATE_RANGES.map((range) => (
                <button
                  key={range}
                  onClick={() => {
                    setDateRange(range);
                    setBrowsePage(1);
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    dateRange === range
                      ? "bg-eucalyptus text-white"
                      : "border border-sea-glass bg-enamel hover:bg-porcelain"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {browseLoading ? (
            <div className="py-12 text-center text-mineral">Loading...</div>
          ) : browseRows.length === 0 ? (
            <EmptyState
              title="No billing records found."
              description="Try a different filter, search term, or date range."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-sea-glass">
              <table className="w-full min-w-[1150px] text-sm">
                <thead className="bg-porcelain">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Patient
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Treatment
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Teeth
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Source
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Created
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Invoice
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Payment
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {browseRows.map((charge) => {
                    const teeth = chargeTeeth(charge);
                    const patientName = charge.patients
                      ? `${charge.patients.first_name} ${charge.patients.last_name}`
                      : "Unknown patient";

                    return (
                      <tr
                        key={charge.id}
                        onClick={() => setDetailCharge(charge)}
                        className="cursor-pointer border-t border-sea-glass transition-colors hover:bg-porcelain"
                      >
                        <td className="px-4 py-4 font-medium text-graphite">
                          {patientName}
                        </td>
                        <td className="px-4 py-4 text-graphite">
                          {charge.treatment_name}
                        </td>
                        <td className="px-4 py-4 text-mineral">
                          {teeth.length === 0
                            ? "—"
                            : teeth.join(" · ")}
                        </td>
                        <td className="px-4 py-4">
                          {charge.treatment_plan_item_id != null ? (
                            <Badge color="blue">Treatment Plan</Badge>
                          ) : (
                            <Badge color="gray">Legacy</Badge>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-graphite">
                          {formatCurrency(Number(charge.amount))}
                        </td>
                        <td className="px-4 py-4">
                          <Badge
                            color={
                              charge.status === "Invoiced" ? "green" : "yellow"
                            }
                          >
                            {charge.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-mineral">
                          {new Date(charge.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-4">
                          {charge.clinic_invoices ? (
                            <span className="font-medium text-eucalyptus">
                              {charge.clinic_invoices.invoice_number}
                            </span>
                          ) : (
                            <span className="text-mineral">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {charge.clinic_invoices ? (
                            <>
                              <p className="font-medium text-graphite">
                                Paid {formatCurrency(Number(charge.clinic_invoices.amount_paid))}
                              </p>
                              <p
                                className={`text-xs font-medium ${
                                  Number(charge.clinic_invoices.balance) > 0
                                    ? "text-ochre-ink"
                                    : "text-sage-ink"
                                }`}
                              >
                                {Number(charge.clinic_invoices.balance) > 0
                                  ? `Outstanding ${formatCurrency(Number(charge.clinic_invoices.balance))}`
                                  : "Paid in full"}
                              </p>
                            </>
                          ) : (
                            <span className="text-mineral">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {charge.clinic_invoices &&
                            Number(charge.clinic_invoices.balance) > 0 && (
                              <Button
                                variant="secondary"
                                className="px-3 py-1.5 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPaymentTarget(charge);
                                }}
                              >
                                Record Payment
                              </Button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!browseLoading && browseCount > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-sea-glass bg-enamel p-4">
              <div className="text-sm text-mineral">
                Showing{" "}
                <span className="font-semibold text-graphite">
                  {(browsePage - 1) * BROWSE_PAGE_SIZE + 1}
                </span>
                {" - "}
                <span className="font-semibold text-graphite">
                  {Math.min(browsePage * BROWSE_PAGE_SIZE, browseCount)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-graphite">
                  {browseCount.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={browsePage === 1}
                  onClick={() =>
                    setBrowsePage((page) => Math.max(1, page - 1))
                  }
                >
                  Previous
                </Button>

                <div className="text-sm font-medium">
                  Page {browsePage} of {browseTotalPages}
                </div>

                <Button
                  variant="secondary"
                  disabled={browsePage >= browseTotalPages}
                  onClick={() =>
                    setBrowsePage((page) =>
                      Math.min(browseTotalPages, page + 1)
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ChargeDetailModal
        charge={detailCharge}
        currency={currency}
        onClose={() => setDetailCharge(null)}
        onPaymentRecorded={handlePaymentRecorded}
      />

      <InvoicePreviewModal
        open={previewOpen}
        charges={selectedCharges}
        patientName={selectedPatientName}
        currency={currency}
        clinicSettings={clinicSettings}
        onClose={() => setPreviewOpen(false)}
        onCreated={handleInvoiceCreated}
      />

      {paymentTarget?.clinic_invoices && (
        <RecordPaymentModal
          invoiceId={paymentTarget.clinic_invoices.id}
          invoiceNumber={paymentTarget.clinic_invoices.invoice_number}
          patientName={
            paymentTarget.patients
              ? `${paymentTarget.patients.first_name} ${paymentTarget.patients.last_name}`
              : "Unknown patient"
          }
          currency={currency}
          total={Number(paymentTarget.clinic_invoices.total)}
          amountPaid={Number(paymentTarget.clinic_invoices.amount_paid)}
          balance={Number(paymentTarget.clinic_invoices.balance)}
          invoicePaymentMethod={paymentTarget.clinic_invoices.payment_method}
          invoiceInsuranceProviderId={
            paymentTarget.clinic_invoices.insurance_provider_id
          }
          invoiceInsuranceProviderName={
            paymentTarget.clinic_invoices.insurance_provider?.name ?? null
          }
          open={paymentTarget != null}
          onClose={() => setPaymentTarget(null)}
          onSuccess={handlePaymentRecorded}
        />
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <PermissionGuard permission="billing">
      <BillingPageContent />
    </PermissionGuard>
  );
}
