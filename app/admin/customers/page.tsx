"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Customer = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    setLoading(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    setCustomers(data || []);
    setLoading(false);
  }

  const filtered = customers.filter((customer) =>
    customer.email
      ?.toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-8 py-12">

        <h1 className="text-5xl font-bold">
          Customers
        </h1>

        <p className="mt-2 text-slate-600">
          View all registered users.
        </p>

        <div className="mt-10 rounded-2xl bg-white p-8 shadow">

          <input
            className="mb-8 w-full rounded-lg border p-3"
            placeholder="Search customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading ? (
            <p>Loading...</p>
          ) : (
            <table className="w-full">

              <thead>

                <tr className="border-b">

                  <th className="p-4 text-left">
                    Email
                  </th>

                  <th className="text-left">
                    Role
                  </th>

                  <th className="text-left">
                    Joined
                  </th>

                </tr>

              </thead>

              <tbody>

                {filtered.map((customer) => (

                  <tr
                    key={customer.id}
                    className="border-b"
                  >

                    <td className="p-4">
                      {customer.email}
                    </td>

                    <td>

                      <span
                        className={
                          customer.role === "admin"
                            ? "font-semibold text-blue-600"
                            : "font-semibold text-green-600"
                        }
                      >
                        {customer.role}
                      </span>

                    </td>

                    <td>
                      {new Date(
                        customer.created_at
                      ).toLocaleDateString()}
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