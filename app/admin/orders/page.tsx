"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  created_at: string;
  user_id: string;
  product_id: string;
  customer_email: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  transaction_code: string;
  approved: boolean;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    setOrders(data || []);
    setLoading(false);
  }

  async function approveOrder(order: Order) {
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        approved: true,
        payment_status: "Approved",
      })
      .eq("id", order.id);

    if (updateError) {
      alert(updateError.message);
      return;
    }

    const { error: purchaseError } = await supabase
      .from("purchases")
      .upsert(
        {
          user_id: order.user_id,
          product_id: order.product_id,
          order_id: order.id,
        },
        {
          onConflict: "user_id,product_id",
        }
      );

    if (purchaseError) {
      alert(purchaseError.message);
      return;
    }

    loadOrders();
  }

  async function rejectOrder(order: Order) {
    const { error } = await supabase
      .from("orders")
      .update({
        approved: false,
        payment_status: "Rejected",
      })
      .eq("id", order.id);

    if (error) {
      alert(error.message);
      return;
    }

    loadOrders();
  }

  const filtered = orders.filter((o) =>
    o.customer_email
      ?.toLowerCase()
      .includes(search.toLowerCase())
  );

  const revenue = orders
    .filter((o) => o.approved)
    .reduce((sum, o) => sum + Number(o.amount), 0);

  const pending = orders.filter(
    (o) => !o.approved
  ).length;

  return (
    <main className="min-h-screen bg-slate-100">

      <div className="mx-auto max-w-7xl px-8 py-12">

        <div className="flex items-center justify-between">

          <div>

            <h1 className="text-5xl font-bold">
              Orders
            </h1>

            <p className="mt-2 text-slate-600">
              Manage customer payments
            </p>

          </div>

        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Revenue
            </p>

            <h2 className="mt-3 text-4xl font-bold text-green-600">
              KES {revenue.toLocaleString()}
            </h2>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Orders
            </p>

            <h2 className="mt-3 text-4xl font-bold">
              {orders.length}
            </h2>

          </div>

          <div className="rounded-2xl bg-white p-8 shadow">

            <p className="text-slate-500">
              Pending
            </p>

            <h2 className="mt-3 text-4xl font-bold text-orange-600">
              {pending}
            </h2>

          </div>

        </div>

        <div className="mt-10 rounded-2xl bg-white p-8 shadow">

          <input
            placeholder="Search customer..."
            className="mb-8 w-full rounded-lg border p-3"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
          />

          {loading ? (

            <p>Loading...</p>

          ) : (

            <table className="w-full">

              <thead>

                <tr className="border-b">

                  <th className="p-4 text-left">
                    Customer
                  </th>

                  <th className="text-left">
                    Amount
                  </th>

                  <th className="text-left">
                    Method
                  </th>

                  <th className="text-left">
                    Code
                  </th>

                  <th className="text-left">
                    Status
                  </th>

                  <th className="text-left">
                    Actions
                  </th>

                </tr>

              </thead>

              <tbody>

                {filtered.map((order) => (

                  <tr
                    key={order.id}
                    className="border-b"
                  >

                    <td className="p-4">
                      {order.customer_email}
                    </td>

                    <td>
                      KES {order.amount.toLocaleString()}
                    </td>

                    <td>
                      {order.payment_method}
                    </td>

                    <td>
                      {order.transaction_code}
                    </td>

                    <td>

                      <span
                        className={
                          order.approved
                            ? "font-semibold text-green-600"
                            : "font-semibold text-orange-600"
                        }
                      >
                        {order.payment_status}
                      </span>

                    </td>

                    <td className="space-x-2">

                      {!order.approved && (

                        <button
                          onClick={() =>
                            approveOrder(order)
                          }
                          className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                        >
                          Approve
                        </button>

                      )}

                      <button
                        onClick={() =>
                          rejectOrder(order)
                        }
                        className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                      >
                        Reject
                      </button>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          )}

        </div>

      </div>

    </main>
  );
}