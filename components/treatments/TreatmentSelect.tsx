"use client";

import { useEffect, useMemo, useState } from "react";

import {
  searchTreatments,
} from "@/services/treatments";

interface Treatment {
  id: string;
  name: string;
  default_price: number;
}

interface Props {
  value: string;
  onChange: (
    treatment: string,
    price: number
  ) => void;
}

export default function TreatmentSelect({
  value,
  onChange,
}: Props) {
  const [query, setQuery] =
    useState(value);

  const [treatments, setTreatments] =
    useState<Treatment[]>([]);

  useEffect(() => {
    loadTreatments();
  }, []);

  async function loadTreatments() {
    try {
      const data =
        await searchTreatments();

      setTreatments(
        data as Treatment[]
      );
    } catch (error) {
      console.error(error);
    }
  }

  const filtered =
    useMemo(() => {
      const term =
        query.toLowerCase();

      return treatments.filter(
        (item) =>
          item.name
            .toLowerCase()
            .includes(term)
      );
    }, [query, treatments]);

  return (
    <div className="space-y-2">

      <label className="block text-sm font-medium">
        Treatment
      </label>

      <input
        value={query}
        placeholder="Search treatment..."
        onChange={(e) =>
          setQuery(
            e.target.value
          )
        }
        className="w-full rounded-xl border border-slate-300 p-3"
      />

      {query.length > 0 &&
        filtered.length > 0 && (

          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">

            {filtered.map(
              (item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setQuery(
                      item.name
                    );

                    onChange(
                      item.name,
                      Number(
                        item.default_price
                      )
                    );
                  }}
                  className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span>
                    {item.name}
                  </span>

                  <span className="font-semibold text-blue-600">
                    KES{" "}
                    {Number(
                      item.default_price
                    ).toLocaleString()}
                  </span>
                </button>
              )
            )}

          </div>

        )}

    </div>
  );
}