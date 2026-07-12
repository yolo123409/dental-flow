"use client";

import {
  Calendar,
  FileText,
  HeartPulse,
  Wrench,
} from "lucide-react";

import {
  PatientTooth,
  ToothCondition,
} from "@/types";

interface Props {
  tooth: number;
  data?: PatientTooth;
}

function getBadge(
  condition?: ToothCondition
) {
  switch (condition) {
    case "Caries":
      return {
        text: "Caries",
        className:
          "bg-red-100 text-red-700 border-red-300",
      };

    case "Filling":
      return {
        text: "Filling",
        className:
          "bg-blue-100 text-blue-700 border-blue-300",
      };

    case "Crown":
      return {
        text: "Crown",
        className:
          "bg-yellow-100 text-yellow-700 border-yellow-300",
      };

    case "Implant":
      return {
        text: "Implant",
        className:
          "bg-purple-100 text-purple-700 border-purple-300",
      };

    case "Missing":
      return {
        text: "Missing",
        className:
          "bg-slate-200 text-slate-700 border-slate-300",
      };

    default:
      return {
        text: "Healthy",
        className:
          "bg-green-100 text-green-700 border-green-300",
      };
  }
}

export default function ToothTooltip({
  tooth,
  data,
}: Props) {
  const badge = getBadge(
    data?.condition
  );

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-50 w-72 -translate-x-1/2 -translate-y-[110%] rounded-2xl border border-slate-200 bg-white shadow-2xl">

      {/* Header */}

      <div className="rounded-t-2xl border-b bg-slate-50 p-4">

        <div className="flex items-center justify-between">

          <h3 className="text-lg font-bold">
            Tooth {tooth}
          </h3>

          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${badge.className}`}
          >
            {badge.text}
          </span>

        </div>

      </div>

      {/* Body */}

      <div className="space-y-5 p-5">

        <div className="flex gap-3">

          <HeartPulse
            size={18}
            className="mt-1 text-blue-600"
          />

          <div>

            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Diagnosis
            </p>

            <p className="mt-1 text-sm">
              {data?.diagnosis ||
                "No diagnosis recorded"}
            </p>

          </div>

        </div>

        <div className="flex gap-3">

          <Wrench
            size={18}
            className="mt-1 text-blue-600"
          />

          <div>

            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Treatment
            </p>

            <p className="mt-1 text-sm">
              {data?.treatment ||
                "No treatment"}
            </p>

          </div>

        </div>

        <div className="flex gap-3">

          <FileText
            size={18}
            className="mt-1 text-blue-600"
          />

          <div>

            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </p>

            <p className="mt-1 line-clamp-3 text-sm">
              {data?.notes ||
                "No clinical notes"}
            </p>

          </div>

        </div>

        {data?.updated_at && (

          <div className="flex gap-3 border-t pt-4">

            <Calendar
              size={18}
              className="mt-1 text-slate-500"
            />

            <div>

              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Last Updated
              </p>

              <p className="mt-1 text-sm">
                {new Date(
                  data.updated_at
                ).toLocaleString()}
              </p>

            </div>

          </div>

        )}

      </div>

    </div>
  );
}