"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getInvoiceBalanceTotals } from "@/services/billing";
import { getClinicSettings } from "@/services/settings";
import { getNewPatientsThisMonthCount } from "@/services/patients";
import { getTodaysAppointmentCount } from "@/services/appointments";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { getSafeErrorMessage } from "@/lib/logError";

export default function PatientStats() {
  const [newThisMonth, setNewThisMonth] = useState<number | null>(null);
  const [todaysVisits, setTodaysVisits] = useState<number | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [currency, setCurrency] = useState("KES");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const realtimeTables = useMemo(
    () => [
      "patients",
      "appointments",
      "clinic_invoices",
      "clinic_payments",
    ],
    []
  );

  const loadStats = useCallback(async () => {
    try {
      setError(null);

      const [
        newPatientCount,
        appointmentCount,
        balanceTotals,
        clinicSettings,
      ] = await Promise.all([
        getNewPatientsThisMonthCount(),
        getTodaysAppointmentCount(),
        getInvoiceBalanceTotals(),
        getClinicSettings(),
      ]);

      setNewThisMonth(newPatientCount);
      setTodaysVisits(appointmentCount);
      setOutstanding(balanceTotals.outstanding);
      setCurrency(clinicSettings.currency || "KES");
    } catch (err) {
      setError(
        getSafeErrorMessage(err, "Failed to load stats.", "Failed to load patient stats:")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadStats,
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

        {loading ? (
          <h2 className="mt-2 text-3xl font-bold text-slate-300">
            ...
          </h2>
        ) : error ? (
          <p className="mt-3 text-sm font-semibold text-red-600">
            Unable to load
          </p>
        ) : (
          <h2 className="mt-2 text-3xl font-bold">
            {newThisMonth}
          </h2>
        )}

      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">

        <p className="text-slate-500">
          Today&apos;s Visits
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
          <h2 className="mt-2 text-3xl font-bold">
            {todaysVisits}
          </h2>
        )}

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
