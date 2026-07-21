"use client";

import {
  UserPlus,
  CalendarPlus,
  Receipt,
  Users,
  ClipboardList,
  Bell,
} from "lucide-react";

import { NotificationType } from "@/types/notification";

const CONFIG: Record<
  NotificationType,
  { icon: typeof Bell; className: string }
> = {
  patient: { icon: UserPlus, className: "bg-blue-100 text-blue-600" },
  appointment: {
    icon: CalendarPlus,
    className: "bg-purple-100 text-purple-600",
  },
  billing: { icon: Receipt, className: "bg-amber-100 text-amber-600" },
  staff: { icon: Users, className: "bg-green-100 text-green-600" },
  treatment_plan: {
    icon: ClipboardList,
    className: "bg-teal-100 text-teal-600",
  },
  system: { icon: Bell, className: "bg-slate-100 text-slate-600" },
};

export default function NotificationTypeIcon({
  type,
}: {
  type: NotificationType;
}) {
  const { icon: Icon, className } = CONFIG[type] ?? CONFIG.system;

  return (
    <div className={`rounded-xl p-2.5 ${className}`}>
      <Icon size={16} />
    </div>
  );
}
