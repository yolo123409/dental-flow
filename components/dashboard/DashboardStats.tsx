"use client";

import {
  Users,
  CalendarDays,
  Stethoscope,
  ShoppingCart,
} from "lucide-react";

import StatCard from "@/components/admin/StatCard";

type Props = {
  patients: number;
  appointments: number;
  dentists: number;
  orders: number;
};

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
        icon={Users}
      />

      <StatCard
        title="Appointments"
        value={appointments}
        icon={CalendarDays}
      />

      <StatCard
        title="Dentists"
        value={dentists}
        icon={Stethoscope}
      />

      <StatCard
        title="Orders"
        value={orders}
        icon={ShoppingCart}
      />

    </div>
  );
}