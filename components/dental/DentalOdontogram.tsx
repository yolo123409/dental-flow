"use client";

import Odontogram from "@/vendor/react-odontogram";
import "@/vendor/react-odontogram/styles.css";

import { PatientTooth } from "@/types";

interface Props {
  teeth: PatientTooth[];
  selectedTooth: number | null;
  onToothClick: (tooth: number) => void;
}

export default function DentalOdontogram({
  teeth,
  selectedTooth,
  onToothClick,
}: Props) {

  /* ------------------------------------------ */
  /* Tooth Colours                              */
  /* ------------------------------------------ */

  const conditions = teeth.map((tooth) => {
    let fillColor = "#ffffff";
    let outlineColor = "#64748b";

    switch (tooth.condition) {
      case "Caries":
        fillColor = "#ef4444";
        outlineColor = "#b91c1c";
        break;

      case "Filling":
        fillColor = "#3b82f6";
        outlineColor = "#1d4ed8";
        break;

      case "Crown":
        fillColor = "#facc15";
        outlineColor = "#ca8a04";
        break;

      case "Implant":
        fillColor = "#8b5cf6";
        outlineColor = "#6d28d9";
        break;

      case "Missing":
        fillColor = "#64748b";
        outlineColor = "#334155";
        break;
    }

    return {
      label: tooth.condition,
      teeth: [`teeth-${tooth.tooth_number}`],
      fillColor,
      outlineColor,
    };
  });

  /* ------------------------------------------ */
  /* Patient Summary                            */
  /* ------------------------------------------ */

  const summary = {
    healthy: 0,
    caries: 0,
    filling: 0,
    crown: 0,
    implant: 0,
    missing: 0,
  };

  teeth.forEach((tooth) => {
    switch (tooth.condition) {
      case "Healthy":
        summary.healthy++;
        break;

      case "Caries":
        summary.caries++;
        break;

      case "Filling":
        summary.filling++;
        break;

      case "Crown":
        summary.crown++;
        break;

      case "Implant":
        summary.implant++;
        break;

      case "Missing":
        summary.missing++;
        break;

      default:
        summary.healthy++;
        break;
    }
  });

  return (
    <div className="space-y-6">

      {/* -------------------------------------- */}
      {/* Patient Oral Health */}
      {/* -------------------------------------- */}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

        <h3 className="mb-5 text-lg font-semibold text-slate-800">
          Patient Oral Health
        </h3>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">

          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded border border-slate-400 bg-white" />
              <span>Healthy</span>
            </div>

            <span className="font-bold">
              {summary.healthy}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-red-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-red-500" />
              <span>Caries</span>
            </div>

            <span className="font-bold text-red-600">
              {summary.caries}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-blue-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-blue-500" />
              <span>Filling</span>
            </div>

            <span className="font-bold text-blue-600">
              {summary.filling}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-yellow-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-yellow-400" />
              <span>Crown</span>
            </div>

            <span className="font-bold text-yellow-700">
              {summary.crown}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-purple-50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-purple-500" />
              <span>Implant</span>
            </div>

            <span className="font-bold text-purple-600">
              {summary.implant}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-slate-500" />
              <span>Missing</span>
            </div>

            <span className="font-bold text-slate-700">
              {summary.missing}
            </span>
          </div>

        </div>

      </div>

      {/* -------------------------------------- */}
      {/* Odontogram */}
      {/* -------------------------------------- */}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

        <Odontogram
          key={selectedTooth ?? "none"}
          theme="light"
          showLabels={false}
          singleSelect
          defaultSelected={
            selectedTooth != null
              ? [`teeth-${selectedTooth}`]
              : []
          }
          teethConditions={conditions}
          onToothClick={onToothClick}
        />

      </div>

    </div>
  );
}