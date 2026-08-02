"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import MaterialModal from "@/components/inventory/MaterialModal";
import AdjustStockModal from "@/components/inventory/AdjustStockModal";

import {
  ClinicInventoryItem,
  InventoryMovement,
  getInventoryItem,
  getMovementHistory,
  getStockStatus,
  getExpiryStatus,
} from "@/services/inventory";

type Tab = "overview" | "history" | "details";

const STOCK_BADGE_CLASSES: Record<string, string> = {
  "In Stock": "bg-green-100 text-green-700",
  "Low Stock": "bg-yellow-100 text-yellow-700",
  "Out of Stock": "bg-red-100 text-red-700",
};

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

  const [history, setHistory] = useState<
    InventoryMovement[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  const [materialModalOpen, setMaterialModalOpen] =
    useState(false);

  const [stockModalOpen, setStockModalOpen] =
    useState(false);

  const loadMaterial = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);

      const [item, movements] = await Promise.all([
        getInventoryItem(id),
        getMovementHistory(id),
      ]);

      setMaterial(item);
      setHistory(movements);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load material."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadMaterial();
  }, [loadMaterial]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(amount);

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

  return (
    <div className="mx-auto max-w-5xl space-y-8">

      <div className="flex items-center justify-between">

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
          <div className="flex gap-3">

            <Button
              variant="secondary"
              onClick={() =>
                setStockModalOpen(true)
              }
            >
              Adjust Stock
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
              Current Inventory Value
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrency(
                quantity * costPerUnit
              )}
            </p>
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

      {tab === "history" && (

        <Card title="Stock History">

          {history.length === 0 ? (

            <p className="py-8 text-center text-sm text-mineral">
              No stock movements recorded yet.
            </p>

          ) : (

            <div className="space-y-3">

              {history.map((movement) => (
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
                      {material.unit}
                      {movement.clinic_users
                        ?.full_name &&
                        ` · ${movement.clinic_users.full_name}`}
                      {movement.notes &&
                        ` · ${movement.notes}`}
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
        onSaved={loadMaterial}
      />

    </div>
  );
}
