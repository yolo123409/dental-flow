"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import MaterialModal from "@/components/inventory/MaterialModal";
import AdjustStockModal from "@/components/inventory/AdjustStockModal";
import RecordConsumptionModal from "@/components/inventory/RecordConsumptionModal";
import ReturnToSupplierModal from "@/components/inventory/ReturnToSupplierModal";

import {
  ClinicInventoryItem,
  InventoryMovement,
  InventoryBatch,
  MovementHistoryPage,
  getInventoryItem,
  getMovementHistory,
  getInventoryBatches,
  getStockStatus,
  getExpiryStatus,
  calculateMarkupFromPrices,
  calculateGrossMargin,
  calculateGrossProfitPerUnit,
  calculateSellingPriceFromMarkup,
  calculateStockValue,
  updateInventoryItemPricing,
} from "@/services/inventory";
import { getClinicSettings, ClinicSettings } from "@/services/settings";
import { getSafeErrorMessage } from "@/lib/logError";

type Tab = "overview" | "batches" | "history" | "details";

const STOCK_BADGE_CLASSES: Record<string, string> = {
  "In Stock": "bg-green-100 text-green-700",
  "Low Stock": "bg-yellow-100 text-yellow-700",
  "Out of Stock": "bg-red-100 text-red-700",
};

const HISTORY_PAGE_SIZE = 25;

// Widened past MovementReason (the user-selectable adjustment reasons) to
// also include "Initial Stock", a system-recorded reason that can appear
// in the ledger but is never chosen by a user.
const MOVEMENT_REASONS: string[] = [
  "Restock",
  "Used",
  "Damaged",
  "Expired",
  "Correction",
  "Returned to Supplier",
  "Initial Stock",
  "Other",
];

export default function MaterialDetailPageWrapper() {
  return (
    <PermissionGuard permission="inventory">
      <MaterialDetailPage />
    </PermissionGuard>
  );
}

function MaterialDetailPage() {
  const params = useParams();
  const router = useRouter();

  const id = String(params.id ?? "");

  const { hasPermission } = usePermissions();
  const canManage = hasPermission(
    "inventory_manage"
  );

  const [material, setMaterial] =
    useState<ClinicInventoryItem | null>(null);

  const [clinic, setClinic] = useState<ClinicSettings | null>(null);

  const [batches, setBatches] = useState<InventoryBatch[]>([]);

  const [historyPage, setHistoryPage] =
    useState<MovementHistoryPage>({ rows: [], count: 0 });

  const [historyOffset, setHistoryOffset] = useState(0);
  const [reasonFilter, setReasonFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");

  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const [materialModalOpen, setMaterialModalOpen] =
    useState(false);

  const [stockModalOpen, setStockModalOpen] =
    useState(false);

  const [consumptionModalOpen, setConsumptionModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  const [applyingMarkup, setApplyingMarkup] = useState(false);

  const loadMaterial = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);

      const [item, itemBatches, clinicSettings] = await Promise.all([
        getInventoryItem(id),
        getInventoryBatches(id),
        getClinicSettings(),
      ]);

      setMaterial(item);
      setBatches(itemBatches);
      setClinic(clinicSettings);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load material.")
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadHistory = useCallback(async () => {
    if (!id) return;

    try {
      setHistoryLoading(true);

      const page = await getMovementHistory(id, {
        reason: reasonFilter || undefined,
        batchNumber: batchFilter || undefined,
        limit: HISTORY_PAGE_SIZE,
        offset: historyOffset,
      });

      setHistoryPage(page);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load stock history.")
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [id, reasonFilter, batchFilter, historyOffset]);

  useEffect(() => {
    loadMaterial();
  }, [loadMaterial]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function refreshAll() {
    setHistoryOffset(0);
    await Promise.all([loadMaterial(), loadHistory()]);
  }

  function handleFilterChange(next: {
    reason?: string;
    batch?: string;
  }) {
    if (next.reason !== undefined) setReasonFilter(next.reason);
    if (next.batch !== undefined) setBatchFilter(next.batch);
    setHistoryOffset(0);
  }

  const formatCurrency = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: clinic?.currency ?? "KES",
        maximumFractionDigits: 0,
      }).format(amount),
    [clinic]
  );

  function formatMovementLabel(movement: InventoryMovement): string {
    const parts: string[] = [movement.reason];

    if (movement.clinic_users?.full_name) {
      parts.push(`by ${movement.clinic_users.full_name}`);
    }

    if (movement.batch_number) {
      parts.push(`batch ${movement.batch_number}`);
    }

    if (movement.clinic_suppliers?.name) {
      parts.push(`supplier: ${movement.clinic_suppliers.name}`);
    }

    if (movement.patients) {
      parts.push(
        `patient: ${movement.patients.first_name} ${movement.patients.last_name}`
      );
    }

    if (movement.clinic_treatments?.name) {
      parts.push(`treatment: ${movement.clinic_treatments.name}`);
    }

    if (movement.reference) {
      parts.push(`ref: ${movement.reference}`);
    }

    if (movement.notes) {
      parts.push(movement.notes);
    }

    return parts.join(" · ");
  }

  async function handleApplyMarkup() {
    if (!material || material.target_markup_percent == null) return;

    try {
      setApplyingMarkup(true);

      const suggested = calculateSellingPriceFromMarkup(
        Number(material.cost_per_unit),
        material.target_markup_percent
      );

      await updateInventoryItemPricing(material.id, {
        selling_price: suggested,
        target_markup_percent: material.target_markup_percent,
        priced_at_cost: Number(material.cost_per_unit),
      });

      toast.success("Selling price updated.");

      await loadMaterial();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to update selling price.")
      );
    } finally {
      setApplyingMarkup(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading material..." />
    );
  }

  if (!material) {
    return (
      <div className="flex h-screen items-center justify-center">
        Material not found.
      </div>
    );
  }

  const quantity = Number(material.quantity);
  const costPerUnit = Number(material.cost_per_unit);
  const minimum = Number(
    material.minimum_stock_level
  );

  const stockStatus = getStockStatus(
    quantity,
    minimum
  );

  const expiryStatus = getExpiryStatus(
    material.expiry_date
  );

  const stockValue = calculateStockValue(material, batches);

  const historyHasMore =
    historyOffset + historyPage.rows.length < historyPage.count;

  return (
    <div className="mx-auto max-w-5xl space-y-8">

      <div className="flex flex-wrap items-start justify-between gap-4">

        <div>

          <button
            onClick={() => router.back()}
            className="text-sm font-medium text-eucalyptus hover:underline"
          >
            ← Back to Inventory
          </button>

          <h1 className="mt-2 font-display text-3xl font-bold">
            {material.name}
          </h1>

          <div className="mt-3 flex flex-wrap gap-2">

            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STOCK_BADGE_CLASSES[stockStatus]}`}
            >
              {stockStatus}
            </span>

            {expiryStatus && (
              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700">
                {expiryStatus}
              </span>
            )}

          </div>

        </div>

        {canManage && (
          <div className="flex flex-wrap gap-3">

            <Button
              variant="secondary"
              onClick={() =>
                setStockModalOpen(true)
              }
            >
              Adjust Stock
            </Button>

            <Button
              variant="secondary"
              onClick={() => setConsumptionModalOpen(true)}
            >
              Record Consumption
            </Button>

            <Button
              variant="secondary"
              onClick={() => setReturnModalOpen(true)}
            >
              Return to Supplier
            </Button>

            <Button
              onClick={() =>
                setMaterialModalOpen(true)
              }
            >
              Edit Material
            </Button>

          </div>
        )}

      </div>

      <div className="flex gap-2">

        {(
          [
            ["overview", "Overview"],
            ["batches", "Batches"],
            ["history", "Stock History"],
            ["details", "Details"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={
              tab === value
                ? "primary"
                : "secondary"
            }
            className="px-4 py-2 text-sm"
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}

      </div>

      {tab === "overview" && (

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Category
            </p>
            <p className="mt-2 text-lg font-semibold">
              {material.category || "-"}
            </p>
          </Card>

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Current Stock
            </p>
            <p className="mt-2 text-lg font-semibold">
              {quantity} {material.unit}
            </p>
          </Card>

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Minimum Stock
            </p>
            <p className="mt-2 text-lg font-semibold">
              {minimum} {material.unit}
            </p>
          </Card>

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Cost Per Unit
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrency(costPerUnit)}
            </p>
          </Card>

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Stock Value
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrency(stockValue)}
            </p>
            {batches.some((batch) => batch.unitCost != null) && (
              <p className="mt-1 text-xs text-mineral">
                Valued at each batch&apos;s received cost where known.
              </p>
            )}
          </Card>

          <Card>
            <p className="text-xs font-bold uppercase tracking-wide text-mineral">
              Batch / Expiry
            </p>
            <p className="mt-2 text-lg font-semibold">
              {material.batch_number || "-"}
            </p>
            <p className="text-sm text-mineral">
              {material.expiry_date
                ? new Date(
                    material.expiry_date
                  ).toLocaleDateString(
                    undefined,
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )
                : "No expiry set"}
            </p>
          </Card>

        </div>

      )}

      {tab === "overview" && (

        <Card title="Pricing">

          {(() => {
            const sellingPrice = material.selling_price;
            const currentMarkup =
              sellingPrice != null
                ? calculateMarkupFromPrices(costPerUnit, sellingPrice)
                : null;
            const grossMargin =
              sellingPrice != null
                ? calculateGrossMargin(costPerUnit, sellingPrice)
                : null;
            const grossProfit =
              sellingPrice != null
                ? calculateGrossProfitPerUnit(costPerUnit, sellingPrice)
                : null;

            const costChanged =
              material.priced_at_cost != null &&
              Number(material.priced_at_cost) !== costPerUnit;

            const oldMarkup =
              costChanged && sellingPrice != null
                ? calculateMarkupFromPrices(
                    Number(material.priced_at_cost),
                    sellingPrice
                  )
                : null;

            const suggestedPrice =
              material.target_markup_percent != null
                ? calculateSellingPriceFromMarkup(
                    costPerUnit,
                    material.target_markup_percent
                  )
                : null;

            return (
              <div className="space-y-6">

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                      Latest Cost
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {formatCurrency(costPerUnit)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                      Selling Price
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {sellingPrice != null
                        ? formatCurrency(sellingPrice)
                        : "Not set"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                      Markup
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {currentMarkup != null ? `${currentMarkup}%` : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                      Gross Margin
                    </p>
                    <p className="mt-2 text-lg font-semibold">
                      {grossMargin != null ? `${grossMargin}%` : "—"}
                    </p>
                  </div>

                </div>

                {grossProfit != null && (
                  <p className="text-sm text-mineral">
                    Potential Gross Profit / Unit:{" "}
                    <span className="font-semibold text-graphite">
                      {formatCurrency(grossProfit)}
                    </span>
                  </p>
                )}

                {costChanged && sellingPrice != null && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-700">
                      Cost {Number(material.priced_at_cost) < costPerUnit
                        ? "increased"
                        : "decreased"}{" "}
                      — review selling price
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      Previous cost {formatCurrency(Number(material.priced_at_cost))}
                      {oldMarkup != null && ` (${oldMarkup}% markup)`} → Current
                      cost {formatCurrency(costPerUnit)}
                      {currentMarkup != null && ` (${currentMarkup}% markup)`}.
                      Selling price is unchanged at{" "}
                      {formatCurrency(sellingPrice)}.
                    </p>

                    {canManage && suggestedPrice != null && (
                      <div className="mt-3 flex items-center gap-3">
                        <p className="text-xs text-amber-700">
                          Suggested selling price at{" "}
                          {material.target_markup_percent}% markup:{" "}
                          <span className="font-semibold">
                            {formatCurrency(suggestedPrice)}
                          </span>
                        </p>

                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          disabled={applyingMarkup}
                          onClick={handleApplyMarkup}
                        >
                          {applyingMarkup
                            ? "Updating..."
                            : `Apply ${material.target_markup_percent}% Markup`}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })()}

        </Card>

      )}

      {tab === "batches" && (

        <Card title="Batches on Hand">

          {batches.length === 0 ? (

            <p className="py-8 text-center text-sm text-mineral">
              No stock on hand yet - receive a GRN or add stock to see
              batches here.
            </p>

          ) : (

            <div className="overflow-x-auto rounded-2xl border border-slate-200">

              <table className="min-w-full">

                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold">
                      Batch
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold">
                      Quantity
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold">
                      Unit Cost
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">
                      Received
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">
                      Expiry
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">
                      Supplier
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">
                      Source
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {batches.map((batch) => {
                    const expiry = getExpiryStatus(batch.expiryDate);

                    return (
                      <tr
                        key={batch.batchNumber ?? "unbatched"}
                        className="border-t border-slate-200"
                      >
                        <td className="px-6 py-5 font-medium">
                          {batch.batchNumber ?? "Unbatched"}
                        </td>
                        <td className="px-6 py-5 text-right">
                          {batch.quantityRemaining} {material.unit}
                        </td>
                        <td className="px-6 py-5 text-right">
                          {batch.unitCost != null
                            ? formatCurrency(batch.unitCost)
                            : "—"}
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {batch.receivedAt
                            ? new Date(batch.receivedAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-6 py-5">
                          {batch.expiryDate ? (
                            <div className="flex flex-col gap-1">
                              <span>
                                {new Date(batch.expiryDate).toLocaleDateString()}
                              </span>
                              {expiry && (
                                <span
                                  className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    expiry === "Expired"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {expiry}
                                </span>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {batch.supplierName ?? "—"}
                        </td>
                        <td className="px-6 py-5">
                          {batch.grnId ? (
                            <Link
                              href={`/admin/inventory/grns/${batch.grnId}`}
                              className="font-medium text-eucalyptus hover:underline"
                            >
                              View GRN
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

              </table>

            </div>

          )}

        </Card>

      )}

      {tab === "history" && (

        <Card title="Stock History">

          <div className="mb-6 flex flex-wrap items-end gap-3">

            <div>
              <label className="mb-2 block text-xs font-semibold text-graphite">
                Reason
              </label>
              <select
                value={reasonFilter}
                onChange={(e) =>
                  handleFilterChange({
                    reason: e.target.value,
                  })
                }
                className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
              >
                <option value="">All Reasons</option>
                {MOVEMENT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>

            {batches.length > 0 && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-graphite">
                  Batch
                </label>
                <select
                  value={batchFilter}
                  onChange={(e) =>
                    handleFilterChange({ batch: e.target.value })
                  }
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
                >
                  <option value="">All Batches</option>
                  {batches.map((batch) => (
                    <option
                      key={batch.batchNumber ?? "unbatched"}
                      value={batch.batchNumber ?? ""}
                    >
                      {batch.batchNumber ?? "Unbatched"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(reasonFilter || batchFilter) && (
              <button
                onClick={() =>
                  handleFilterChange({ reason: "", batch: "" })
                }
                className="text-sm font-medium text-eucalyptus hover:underline"
              >
                Clear Filters
              </button>
            )}

          </div>

          {historyLoading ? (

            <p className="py-8 text-center text-sm text-mineral">
              Loading...
            </p>

          ) : historyPage.rows.length === 0 ? (

            <p className="py-8 text-center text-sm text-mineral">
              No stock movements match these filters.
            </p>

          ) : (

            <div className="space-y-3">

              {historyPage.rows.map((movement) => (
                <div
                  key={movement.id}
                  className="flex items-center justify-between rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm"
                >

                  <div>

                    <p className="font-semibold text-graphite">
                      <span
                        className={
                          movement.movement_type ===
                          "Increase"
                            ? "text-eucalyptus"
                            : "text-clay"
                        }
                      >
                        {movement.movement_type ===
                        "Increase"
                          ? "+"
                          : "-"}
                        {Math.abs(
                          Number(
                            movement.quantity_change
                          )
                        )}
                      </span>{" "}
                      — {movement.reason}
                    </p>

                    <p className="mt-1 text-xs text-mineral">
                      {movement.quantity_before} →{" "}
                      {movement.quantity_after}{" "}
                      {material.unit} · {formatMovementLabel(movement)}
                    </p>

                  </div>

                  <span className="whitespace-nowrap text-xs text-mineral">
                    {formatRelativeTime(
                      movement.created_at
                    )}
                  </span>

                </div>
              ))}

            </div>

          )}

          {historyPage.count > HISTORY_PAGE_SIZE && (
            <div className="mt-6 flex items-center justify-between text-sm">
              <span className="text-mineral">
                Showing {historyOffset + 1}–
                {historyOffset + historyPage.rows.length} of{" "}
                {historyPage.count}
              </span>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-2 text-xs"
                  disabled={historyOffset === 0 || historyLoading}
                  onClick={() =>
                    setHistoryOffset((offset) =>
                      Math.max(0, offset - HISTORY_PAGE_SIZE)
                    )
                  }
                >
                  Previous
                </Button>

                <Button
                  variant="secondary"
                  className="px-3 py-2 text-xs"
                  disabled={!historyHasMore || historyLoading}
                  onClick={() =>
                    setHistoryOffset(
                      (offset) => offset + HISTORY_PAGE_SIZE
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

      {tab === "details" && (

        <Card title="Details">

          <dl className="grid gap-6 sm:grid-cols-2">

            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">
                Unit
              </dt>
              <dd className="mt-1">
                {material.unit}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">
                Batch / Lot Number
              </dt>
              <dd className="mt-1">
                {material.batch_number || "-"}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">
                Expiry Date
              </dt>
              <dd className="mt-1">
                {material.expiry_date
                  ? new Date(
                      material.expiry_date
                    ).toLocaleDateString()
                  : "-"}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">
                Last Updated
              </dt>
              <dd className="mt-1">
                {new Date(
                  material.updated_at
                ).toLocaleString()}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-wide text-mineral">
                Notes
              </dt>
              <dd className="mt-1 whitespace-pre-wrap">
                {material.notes || "No notes"}
              </dd>
            </div>

          </dl>

        </Card>

      )}

      <MaterialModal
        open={materialModalOpen}
        material={material}
        onClose={() =>
          setMaterialModalOpen(false)
        }
        onSaved={loadMaterial}
      />

      <AdjustStockModal
        open={stockModalOpen}
        material={material}
        onClose={() => setStockModalOpen(false)}
        onSaved={refreshAll}
      />

      <RecordConsumptionModal
        open={consumptionModalOpen}
        material={material}
        batches={batches}
        onClose={() => setConsumptionModalOpen(false)}
        onSaved={refreshAll}
      />

      <ReturnToSupplierModal
        open={returnModalOpen}
        material={material}
        batches={batches}
        onClose={() => setReturnModalOpen(false)}
        onSaved={refreshAll}
      />

    </div>
  );
}
