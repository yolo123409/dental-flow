"use client";

import {
  Users,
  CalendarDays,
  Stethoscope,
  ShoppingCart,
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
        subtitle="Registered patients"
        icon={<Users size={22} />}
      />

      <StatCard
        title="Appointments"
        value={appointments}
        subtitle="Clinic appointments"
        icon={<CalendarDays size={22} />}
      />

      <StatCard
        title="Dentists"
        value={dentists}
        subtitle="Active dentists"
        icon={<Stethoscope size={22} />}
      />

      <StatCard
        title="Orders"
        value={orders}
        subtitle="Customer orders"
        icon={<ShoppingCart size={22} />}
      />

    </div>
  );
}