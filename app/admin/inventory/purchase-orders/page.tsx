"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import POStatusBadge from "@/components/procurement/POStatusBadge";
import NewPurchaseOrderModal from "@/components/procurement/NewPurchaseOrderModal";

import usePermissions from "@/hooks/usePermissions";
import { getPurchaseOrders } from "@/services/purchaseOrders";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { PurchaseOrder, PurchaseOrderStatus } from "@/types/procurement";

const STATUS_FILTERS: ("All" | PurchaseOrderStatus)[] = [
  "All",
  "Draft",
  "Sent",
  "Partially Received",
  "Received",
  "Cancelled",
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

function PurchaseOrdersPageContent() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<"All" | PurchaseOrderStatus>(
    "All"
  );
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function load() {
    try {
      setLoading(true);

      const data = await getPurchaseOrders(
        statusFilter === "All" ? {} : { status: statusFilter }
      );

      setOrders(data);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to load purchase orders.",
          "[PurchaseOrdersPage] load failed:"
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Purchase Orders</h1>
          <p className="mt-2 text-slate-500">
            Raise and track orders sent to your suppliers.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setModalOpen(true)}>
            + New Purchase Order
          </Button>
        )}
      </div>

      <Card>
        <div className="mb-6 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "primary" : "secondary"}
              className="px-3 py-2 text-xs"
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </Button>
          ))}
        </div>

        {loading ? (
          <LoadingSpinner text="Loading purchase orders..." />
        ) : orders.length === 0 ? (
          <EmptyState
            title="No purchase orders"
            description="Create a purchase order to start ordering from a supplier."
            action={
              canManage ? (
                <Button onClick={() => setModalOpen(true)}>
                  + New Purchase Order
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    PO Number
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Supplier
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Order Date
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Expected Delivery
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Total
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {orders.map((po) => (
                  <tr key={po.id} className="border-t border-slate-200">
                    <td className="px-6 py-5 font-medium">
                      <Link
                        href={`/admin/inventory/purchase-orders/${po.id}`}
                        className="text-eucalyptus hover:underline"
                      >
                        {po.po_number}
                      </Link>
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {po.clinic_suppliers?.name ?? "-"}
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {new Date(po.order_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {po.expected_delivery_date
                        ? new Date(po.expected_delivery_date).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-6 py-5 text-right font-semibold">
                      {formatCurrency(po.total)}
                    </td>
                    <td className="px-6 py-5">
                      <POStatusBadge status={po.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewPurchaseOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => router.push(`/admin/inventory/purchase-orders/${id}`)}
      />
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <PermissionGuard permission="procurement">
      <PurchaseOrdersPageContent />
    </PermissionGuard>
  );
}
