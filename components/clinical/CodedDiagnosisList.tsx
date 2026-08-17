"use client";

import { X } from "lucide-react";

import { AttachedDiagnosisCode } from "@/types/clinicalCodes";

interface Props {
  codes: AttachedDiagnosisCode[];
  onRemove?: (key: string) => void;
  /** Hides the remove control - used for read-only surfaces like Tooth History, where showing an interactive "X" that does nothing would be misleading. */
  readOnly?: boolean;
}

/**
 * Compact chip list for attached ICD-10-CM diagnosis codes - used
 * wherever a diagnosis is entered (Tooth Details / TreatmentForm).
 * Purely presentational/controlled: the parent form owns the array and
 * decides what "remove" means (local-only removal until the surrounding
 * form is actually saved).
 */
export default function CodedDiagnosisList({ codes, onRemove, readOnly = false }: Props) {
  if (codes.length === 0) return null;

  return (
    <div className="space-y-2">
      {codes.map((item) => (
        <div
          key={item.key}
          className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div>
            <span className="font-mono text-sm font-semibold text-blue-700">{item.code.code}</span>
            <span className="ml-2 text-sm text-slate-600">{item.code.short_description}</span>
          </div>

          {!readOnly && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
              aria-label={`Remove ${item.code.code}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
