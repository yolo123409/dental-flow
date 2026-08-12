"use client";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

import {
  OrganizationLowStockItem,
  OrganizationHighestValueItem,
  OrganizationGrnReceipt,
} from "@/services/organizationAnalytics";

interface Props {
  lowStock: OrganizationLowStockItem[];
  highestValue: OrganizationHighestValueItem[];
  recentlyReceived: OrganizationGrnReceipt[];
  currency: string;
  loading: boolean;
}

export default function OrganizationInventoryWidget({
  lowStock,
  highestValue,
  recentlyReceived,
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
      <Card title="Inventory">
        <p className="text-sm text-mineral">Loading...</p>
      </Card>
    );
  }

  return (
    <Card title="Inventory">
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Low Stock
          </p>

          {lowStock.length === 0 ? (
            <p className="text-sm text-mineral">
              Nothing is low on stock across your branches.
            </p>
          ) : (
            <div className="space-y-2">
              {lowStock.map((item) => (
                <div
                  key={`${item.clinic_id}-${item.item_id}`}
                  className="rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-graphite">
                      {item.item_name}
                    </span>
                    <Badge color="red">
                      {item.quantity} / {item.minimum_stock_level}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-mineral">
                    {item.clinic_name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Highest Value Inventory
          </p>

          {highestValue.length === 0 ? (
            <p className="text-sm text-mineral">No inventory recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {highestValue.map((item) => (
                <div
                  key={`${item.clinic_id}-${item.item_id}`}
                  className="flex items-center justify-between rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <div>
                    <p className="text-graphite">{item.item_name}</p>
                    <p className="text-xs text-mineral">
                      {item.clinic_name}
                    </p>
                  </div>
                  <span className="font-semibold text-graphite">
                    {formatMoney(item.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mineral">
            Recently Received Stock
          </p>

          {recentlyReceived.length === 0 ? (
            <p className="text-sm text-mineral">No deliveries yet.</p>
          ) : (
            <div className="space-y-2">
              {recentlyReceived.map((receipt) => (
                <div
                  key={receipt.movement_id}
                  className="rounded-lg border border-sea-glass px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-graphite">
                      {receipt.item_name}
                    </span>
                    <Badge color="green">+{receipt.quantity_change}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-mineral">
                    {receipt.clinic_name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-5 text-xs text-mineral">
        Inventory value by branch is shown in the Branch Performance table
        below.
      </p>
    </Card>
  );
}
