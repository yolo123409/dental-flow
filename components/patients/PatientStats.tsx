"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getInvoices, calculateBalance } from "@/services/billing";
import { getClinicSettings } from "@/services/settings";

import useRealtimeTables from "@/hooks/useRealtimeTables";

export default function PatientStats() {
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [currency, setCurrency] = useState("KES");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const realtimeTables = useMemo(
    () => ["clinic_invoices", "clinic_payments"],
    []
  );

  const loadOutstandingBalance = useCallback(async () => {
    try {
      setError(null);

      const [invoices, clinicSettings] = await Promise.all([
        getInvoices(),
        getClinicSettings(),
      ]);

      setOutstanding(calculateBalance(invoices).outstanding);
      setCurrency(clinicSettings.currency || "KES");
    } catch (err) {
      console.error("Failed to load outstanding balance:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load balance."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOutstandingBalance();
  }, [loadOutstandingBalance]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadOutstandingBalance,
  });

  const formattedOutstanding =
    outstanding !== null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(outstanding)
      : null;

  return (
    <div className="grid gap-6 md:grid-cols-3">

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          New This Month
        </p>

        <h2 className="mt-2 text-3xl font-bold">
          18
        </h2>

      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          Today&apos;s Visits
        </p>

        <h2 className="mt-2 text-3xl font-bold">
          12
        </h2>

      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          Outstanding Balance
        </p>

        {loading ? (
          <h2 className="mt-2 text-3xl font-bold text-slate-300">
            ...
          </h2>
        ) : error ? (
          <p className="mt-3 text-sm font-semibold text-red-600">
            Unable to load
          </p>
        ) : (
          <h2 className="mt-2 text-3xl font-bold text-red-600">
            {formattedOutstanding}
          </h2>
        )}

      </div>

    </div>
  );
}
