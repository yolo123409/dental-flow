"use client";

import {
  Users,
  CalendarDays,
  Stethoscope,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";

interface Props {
  patients: number;
  appointments: number;
  dentists: number;
}

export default function DashboardStats({
  patients,
  appointments,
  dentists,
}: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-3">

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

    </div>
  );
}