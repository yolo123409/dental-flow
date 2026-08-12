"use client";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

import POStatusBadge from "@/components/procurement/POStatusBadge";

import {
  OrganizationRecentPurchaseOrder,
  OrganizationSupplierSpend,
  OrganizationGrnReceipt,
} from "@/services/organizationAnalytics";

import { PurchaseOrderStatus } from "@/types/procurement";

interface Props {
  recentPurchaseOrders: OrganizationRecentPurchaseOrder[];
  topSuppliers: OrganizationSupplierSpend[];
  recentDeliveries: OrganizationGrnReceipt[];
  currency: string;
  loading: boolean;
}

export default function OrganizationProcurementWidget({
  recentPurchaseOrders,
  topSuppliers,
  recentDeliveries,
  currency,
  loading,
}: Props) {
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  if (loading) {
    return (
      <Card title="Procurement">
        <p className="text-sm text-mineral">Loading...</p>
      </Card>
    );
  }

  return (
    <Card title="Procurement">
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Recent Purchase Orders
          </p>

          {recentPurchaseOrders.length === 0 ? (
            <p className="text-sm text-mineral">No purchase orders yet.</p>
          ) : (
            <div className="space-y-2">
              {recentPurchaseOrders.map((po) => (
                <div
                  key={po.po_id}
                  className="rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-graphite">
                      {po.po_number}
                    </span>
                    <POStatusBadge
                      status={po.status as PurchaseOrderStatus}
                    />
                  </div>
                  <p className="mt-1 text-xs text-mineral">
                    {po.clinic_name} · {po.supplier_name ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Top Suppliers
          </p>

          {topSuppliers.length === 0 ? (
            <p className="text-sm text-mineral">No supplier spend yet.</p>
          ) : (
            <div className="space-y-2">
              {topSuppliers.map((supplier) => (
                <div
                  key={supplier.supplier_id}
                  className="flex items-center justify-between rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <span className="text-graphite">
                    {supplier.supplier_name}
                  </span>
                  <span className="font-semibold text-graphite">
                    {formatMoney(supplier.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Recent Deliveries
          </p>

          {recentDeliveries.length === 0 ? (
            <p className="text-sm text-mineral">No deliveries yet.</p>
          ) : (
            <div className="space-y-2">
              {recentDeliveries.map((delivery) => (
                <div
                  key={delivery.movement_id}
                  className="rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-graphite">
                      {delivery.item_name}
                    </span>
                    <Badge color="green">+{delivery.quantity_change}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-mineral">
                    {delivery.clinic_name}
                    {delivery.supplier_name ? ` · ${delivery.supplier_name}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
