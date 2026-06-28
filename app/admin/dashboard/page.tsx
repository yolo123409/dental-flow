"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Stats = {
  products: number;
  orders: number;
  customers: number;
  revenue: number;
};

export default function AdminDashboard() {
  const router = useRouter();

  const [stats, setStats] = useState<Stats>({
    products: 0,
    orders: 0,
    customers: 0,
    revenue: 0,
  });

  const [email, setEmail] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    setEmail(user.email || "");

    const [productsRes, ordersRes, customersRes] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("orders").select("*"),
      supabase.from("profiles").select("*"),
    ]);

    const products = productsRes.data || [];
    const orders = ordersRes.data || [];
    const customers = customersRes.data || [];

    const revenue = orders
      .filter((o: any) => o.approved)
      .reduce((sum: number, o: any) => sum + Number(o.amount), 0);

    setStats({
      products: products.length,
      orders: orders.length,
      customers: customers.length,
      revenue,
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <div className="mx-auto max-w-7xl px-8 py-12">

        <div className="mb-10 flex items-center justify-between">

          <div>
            <h1 className="text-5xl font-bold">
              Dental Flow Admin
            </h1>

            <p className="mt-2 text-slate-600">
              {email}
            </p>
          </div>

          <button
            onClick={logout}
            className="rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700"
          >
            Logout
          </button>

        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Products
            </p>

            <h2 className="mt-3 text-5xl font-bold text-blue-600">
              {stats.products}
            </h2>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Orders
            </p>

            <h2 className="mt-3 text-5xl font-bold text-green-600">
              {stats.orders}
            </h2>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Customers
            </p>

            <h2 className="mt-3 text-5xl font-bold text-purple-600">
              {stats.customers}
            </h2>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Revenue
            </p>

            <h2 className="mt-3 text-4xl font-bold text-orange-600">
              KES {stats.revenue.toLocaleString()}
            </h2>

          </div>

        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">

          <Link
            href="/admin/products"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              📦 Products
            </h2>

            <p className="mt-3 text-slate-600">
              Add, edit and manage AI systems.
            </p>
          </Link>

          <Link
            href="/admin/orders"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              💳 Orders
            </h2>

            <p className="mt-3 text-slate-600">
              Review and approve customer payments.
            </p>
          </Link>

          <Link
            href="/admin/customers"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              👥 Customers
            </h2>

            <p className="mt-3 text-slate-600">
              View customer accounts and purchases.
            </p>
          </Link>

          <Link
            href="/admin/receptionist"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              🤖 AI Receptionist
            </h2>

            <p className="mt-3 text-slate-600">
              Configure voice AI, WhatsApp and booking.
            </p>
          </Link>

          <Link
            href="/admin/analytics"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              📈 Analytics
            </h2>

            <p className="mt-3 text-slate-600">
              Monitor sales and AI performance.
            </p>
          </Link>

          <Link
            href="/admin/settings"
            className="rounded-2xl bg-white p-8 shadow transition hover:shadow-xl"
          >
            <h2 className="text-2xl font-bold">
              ⚙️ Settings
            </h2>

            <p className="mt-3 text-slate-600">
              Configure Dental Flow.
            </p>
          </Link>

        </div>

      </div>

    </main>
  );
}