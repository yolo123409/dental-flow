"use client";

import HistoryCard from "./HistoryCard";

export interface HistoryItem {
  id: string;

  condition: string;

  diagnosis: string | null;

  treatment: string | null;

  treatment_status: string | null;

  materials: string | null;

  estimated_cost: number | null;

  notes: string | null;

  created_at: string;
}

interface Props {
  history: HistoryItem[];
}

export default function ToothHistoryTab({
  history,
}: Props) {
  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-8 py-16 text-center">

        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl shadow-sm">
          🦷
        </div>

        <h3 className="text-lg font-semibold text-slate-800">
          No Treatment History
        </h3>

        <p className="mt-2 text-sm text-slate-500">
          This tooth doesn&apos;t have any saved treatment
          records yet.
        </p>

      </div>
    );
  }

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between">

        <div>

          <h3 className="text-lg font-semibold text-slate-900">
            Treatment Timeline
          </h3>

          <p className="text-sm text-slate-500">
            {history.length}{" "}
            {history.length === 1
              ? "record"
              : "records"}
          </p>

        </div>

      </div>

      <div className="space-y-4">

        {history.map((item) => (
          <HistoryCard
            key={item.id}
            item={item}
          />
        ))}

      </div>

    </div>
  );
}