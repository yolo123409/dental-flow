"use client";

import { useEffect, useMemo, useState } from "react";

import { searchTreatments } from "@/services/treatments";

interface Treatment {
  id: string;
  name: string;
  category: string;
  default_price: number;
}

interface Props {
  onSelect: (
    treatment: string,
    price: number
  ) => void;
}

export default function TreatmentPicker({
  onSelect,
}: Props) {
  const [query, setQuery] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [treatments, setTreatments] =
    useState<Treatment[]>([]);

  async function loadTreatments() {
    try {
      setLoading(true);

      const result =
        await searchTreatments();

      console.log(
        "Treatment search result:",
        result
      );

      setTreatments(
        result as Treatment[]
      );
    } catch (error) {
      console.error(
        "Failed to load treatments:",
        error
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTreatments();
  }, []);

  const filtered =
    useMemo(() => {
      if (!query.trim()) {
        return [];
      }

      const term =
        query.toLowerCase();

      return treatments.filter(
        (item) =>
          item.name
            .toLowerCase()
            .includes(term) ||
          item.category
            .toLowerCase()
            .includes(term)
      );
    }, [query, treatments]);

  console.log(
    "Loaded treatments:",
    treatments
  );

  console.log(
    "Filtered treatments:",
    filtered
  );

  return (
    <div className="space-y-2">

      <label className="block text-sm font-medium">
        Treatment Catalogue
      </label>

      <input
        value={query}
        placeholder="Search treatments..."
        onChange={(e) =>
          setQuery(
            e.target.value
          )
        }
        className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
      />

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          Loading treatments...
        </div>
      )}

      {!loading &&
        query.trim() !== "" &&
        filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
            No treatments found.
          </div>
        )}

      {filtered.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">

          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(
                  item.name,
                  Number(
                    item.default_price
                  )
                );

                setQuery("");
              }}
              className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"
            >
              <div>

                <p className="font-medium">
                  {item.name}
                </p>

                <p className="text-xs text-slate-500">
                  {item.category}
                </p>

              </div>

              <span className="font-semibold text-blue-600">
                KES{" "}
                {Number(
                  item.default_price
                ).toLocaleString()}
              </span>

            </button>
          ))}

        </div>
      )}

    </div>
  );
}