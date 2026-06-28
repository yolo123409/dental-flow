"use client";

import { useEffect, useState } from "react";
import {
  Users,
  CalendarDays,
  Stethoscope,
  ShoppingCart,
} from "lucide-react";

import { supabase } from "@/lib/supabase";

import StatCard from "@/components/admin/StatCard";
import Card from "@/components/ui/Card";

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    patients: 0,
    appointments: 0,
    dentists: 0,
    orders: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const [
      patients,
      appointments,
      dentists,
      orders,
    ] = await Promise.all([
      supabase.from("patients").select("*", { count: "exact", head: true }),
      supabase.from("appointments").select("*", { count: "exact", head: true }),
      supabase.from("dentists").select("*", { count: "exact", head: true }),
      supabase.from("orders").select("*", { count: "exact", head: true }),
    ]);

    setStats({
      patients: patients.count ?? 0,
      appointments: appointments.count ?? 0,
      dentists: dentists.count ?? 0,
      orders: orders.count ?? 0,
    });
  }

  return (
    <div className="space-y-8">

      <div>

        <h1 className="text-4xl font-bold">
          Dashboard
        </h1>

        <p className="mt-2 text-slate-500">
          Welcome back to Dental Flow.
        </p>

      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <StatCard
          title="Patients"
          value={stats.patients}
          icon={Users}
        />

        <StatCard
          title="Appointments"
          value={stats.appointments}
          icon={CalendarDays}
        />

        <StatCard
          title="Dentists"
          value={stats.dentists}
          icon={Stethoscope}
        />

        <StatCard
          title="Orders"
          value={stats.orders}
          icon={ShoppingCart}
        />

      </div>

      <div className="grid gap-6 lg:grid-cols-2">

        <Card title="Today's Activity">

          <div className="space-y-4">

            <div className="rounded-xl bg-slate-50 p-4">
              🦷 Appointments today
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              👤 New patients
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              🤖 AI conversations
            </div>

          </div>

        </Card>

        <Card title="Revenue">

          <div className="flex h-72 items-center justify-center rounded-xl border border-dashed">

            <p className="text-slate-500">
              Revenue chart coming soon
            </p>

          </div>

        </Card>

      </div>

    </div>
  );
}