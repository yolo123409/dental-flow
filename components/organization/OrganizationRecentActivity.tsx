"use client";

import {
  UserRound,
  CalendarDays,
  Receipt,
  PackageCheck,
  ClipboardList,
  Wallet,
} from "lucide-react";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

import {
  OrganizationActivityItem,
  OrganizationActivitySourceType,
} from "@/services/organizationAnalytics";

interface Props {
  items: OrganizationActivityItem[];
  loading: boolean;
}

const SOURCE_META: Record<
  OrganizationActivitySourceType,
  { icon: typeof UserRound; label: string }
> = {
  patient: { icon: UserRound, label: "New patient" },
  appointment: { icon: CalendarDays, label: "Appointment" },
  invoice: { icon: Receipt, label: "Invoice" },
  grn: { icon: PackageCheck, label: "Goods received" },
  purchase_order: { icon: ClipboardList, label: "Purchase order" },
  expense: { icon: Wallet, label: "Money out" },
};

export default function OrganizationRecentActivity({
  items,
  loading,
}: Props) {
  if (loading) {
    return (
      <Card title="Recent Activity">
        <p className="text-sm text-mineral">Loading...</p>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card title="Recent Activity">
        <p className="text-sm text-mineral">
          Nothing recorded yet across your branches.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Recent Activity">
      <div className="space-y-2">
        {items.map((item) => {
          const meta = SOURCE_META[item.source_type];
          const Icon = meta.icon;

          return (
            <div
              key={`${item.source_type}-${item.source_id}`}
              className="flex items-center gap-3 rounded-lg border border-sea-glass px-3 py-2.5 text-sm"
            >
              <div className="rounded-lg bg-sea-glass p-2 text-eucalyptus">
                <Icon size={16} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-graphite">
                  {meta.label}: {item.label}
                </p>
                <p className="text-xs text-mineral">
                  {new Date(item.occurred_at).toLocaleDateString()}
                </p>
              </div>

              <Badge color="gray">{item.clinic_name}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
