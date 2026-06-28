"use client";

import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  XCircle,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";

interface Props {
  total: number;
  scheduled: number;
  completed: number;
  cancelled: number;
}

export default function AppointmentStats({
  total,
  scheduled,
  completed,
  cancelled,
}: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

      <StatCard
        title="Total"
        value={total}
        icon={<CalendarDays size={24} />}
      />

      <StatCard
        title="Scheduled"
        value={scheduled}
        icon={<Clock3 size={24} />}
      />

      <StatCard
        title="Completed"
        value={completed}
        icon={<CheckCircle2 size={24} />}
      />

      <StatCard
        title="Cancelled"
        value={cancelled}
        icon={<XCircle size={24} />}
      />

    </div>
  );
}