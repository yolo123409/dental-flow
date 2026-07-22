import { Check, Clock3, X } from "lucide-react";
import type { ReactNode } from "react";

export type CareStatus = "Scheduled" | "Ongoing" | "Completed" | "Cancelled";

const config: Record<CareStatus, { className: string; label: string; icon: typeof Clock3 }> = {
  Scheduled: { className: "care-rail-scheduled", label: "Scheduled", icon: Clock3 },
  Ongoing: { className: "care-rail-ongoing", label: "In chair", icon: Clock3 },
  Completed: { className: "care-rail-completed", label: "Completed", icon: Check },
  Cancelled: { className: "care-rail-cancelled", label: "Cancelled", icon: X },
};

export function statusClass(status: string) {
  return `status-${status.toLowerCase()}`;
}

export default function CareRail({
  status,
  children,
  className = "",
  showLabel = true,
}: {
  status: CareStatus | string;
  children: ReactNode;
  className?: string;
  showLabel?: boolean;
}) {
  const item = config[status as CareStatus] ?? config.Scheduled;
  const Icon = item.icon;

  return (
    <div className={`border-l-2 pl-4 ${item.className} ${className}`}>
      {showLabel && (
        <span className={`mb-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] ${statusClass(status)}`}>
          <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
          {item.label}
        </span>
      )}
      {children}
    </div>
  );
}
