"use client";

import { useEffect, useState } from "react";

import {
  Users,
  CalendarDays,
  Stethoscope,
  ShoppingCart,
} from "lucide-react";

import { supabase } from "@/lib/supabase";

import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
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
    try {
      const [
        patients,
        appointments,
        dentists,
        orders,
      ] = await Promise.all([
        supabase
          .from("patients")
          .select("*", {
            count: "exact",
            head: true,
          }),

        supabase
          .from("appointments")
          .select("*", {
            count: "exact",
            head: true,
          }),

        supabase
          .from("dentists")
          .select("*", {
            count: "exact",
            head: true,
          }),

        supabase
          .from("orders")
          .select("*", {
            count: "exact",
            head: true,
          }),
      ]);

      setStats({
        patients: patients.count ?? 0,
        appointments: appointments.count ?? 0,
        dentists: dentists.count ?? 0,
        orders: orders.count ?? 0,
      });
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    }
  }

  return (
    <PageContainer>

      <PageHeader
        title="Good Morning 👋"
        description="Welcome back to Dental Flow. Here's what's happening in your clinic today."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <StatCard
          title="Patients"
          value={stats.patients}
          subtitle="Registered patients"
          icon={<Users size={22} />}
        />

        <StatCard
          title="Appointments"
          value={stats.appointments}
          subtitle="Scheduled appointments"
          icon={<CalendarDays size={22} />}
        />

        <StatCard
          title="Dentists"
          value={stats.dentists}
          subtitle="Active dentists"
          icon={<Stethoscope size={22} />}
        />

        <StatCard
          title="Orders"
          value={stats.orders}
          subtitle="Customer orders"
          icon={<ShoppingCart size={22} />}
        />

      </div>

      <div className="grid gap-6 xl:grid-cols-3">

        <Card
          title="Today's Activity"
          className="xl:col-span-2"
        >

          <div className="space-y-4">

            <div className="flex items-center justify-between rounded-xl bg-blue-50 p-5">

              <div>

                <h3 className="font-semibold">
                  Today's Appointments
                </h3>

                <p className="text-sm text-slate-500">
                  Monitor today's clinic schedule.
                </p>

              </div>

              <Badge>
                {stats.appointments}
              </Badge>

            </div>

            <div className="flex items-center justify-between rounded-xl bg-green-50 p-5">

              <div>

                <h3 className="font-semibold">
                  Registered Patients
                </h3>

                <p className="text-sm text-slate-500">
                  Current patient database.
                </p>

              </div>

              <Badge color="green">
                {stats.patients}
              </Badge>

            </div>

            <div className="flex items-center justify-between rounded-xl bg-yellow-50 p-5">

              <div>

                <h3 className="font-semibold">
                  AI Receptionist
                </h3>

                <p className="text-sm text-slate-500">
                  AI assistant is online.
                </p>

              </div>

              <Badge color="blue">
                Active
              </Badge>

            </div>

          </div>

        </Card>

        <Card title="Clinic Overview">

          <div className="space-y-6">

            <div>

              <p className="text-sm text-slate-500">
                Active Dentists
              </p>

              <h2 className="mt-1 text-3xl font-bold">
                {stats.dentists}
              </h2>

            </div>

            <div>

              <p className="text-sm text-slate-500">
                Orders
              </p>

              <h2 className="mt-1 text-3xl font-bold">
                {stats.orders}
              </h2>

            </div>

            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-300">

              <p className="text-slate-500">
                📈 Revenue analytics coming soon
              </p>

            </div>

          </div>

        </Card>

      </div>

    </PageContainer>
  );
}