"use client";

import {
  Users,
  CalendarDays,
  UserRound,
  Package,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";

interface Props {
  patients: number;
  appointments: number;
  dentists: number;
  orders: number;
}

export default function DashboardStats({
  patients,
  appointments,
  dentists,
  orders,
}: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

      <StatCard
        title="Patients"
        value={patients}
        icon={<Users size={24} />}
      />

      <StatCard
        title="Appointments"
        value={appointments}
        icon={<CalendarDays size={24} />}
      />

      <StatCard
        title="Dentists"
        value={dentists}
        icon={<UserRound size={24} />}
      />

      <StatCard
        title="Orders"
        value={orders}
        icon={<Package size={24} />}
      />

    </div>
  );
}