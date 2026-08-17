"use client";

import { useEffect, useState } from "react";

import HistoryCard from "./HistoryCard";

import CodedDiagnosisList from "@/components/clinical/CodedDiagnosisList";
import CodedProcedureList from "@/components/clinical/CodedProcedureList";

import { getDiagnosisCodesForTooth, getProcedureCodesForTooth } from "@/services/clinicalCodes";
import { AttachedDiagnosisCode, AttachedProcedureCode } from "@/types/clinicalCodes";

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
  patientId: string;

  tooth: number;

  history: HistoryItem[];
}

/**
 * Codes aren't versioned per historical entry - they reflect the
 * tooth's CURRENT coding, added/removed via Tooth Details. This shows
 * them once, clearly labeled as current rather than implying a specific
 * past entry was coded at the time it was recorded (which this data
 * model doesn't actually track). Only ever shows codes that were
 * explicitly added after this feature existed - a tooth with no coding
 * simply shows nothing here, never a fabricated/backfilled code.
 */
function CurrentCoding({ patientId, tooth }: { patientId: string; tooth: number }) {
  const [diagnosisCodes, setDiagnosisCodes] = useState<AttachedDiagnosisCode[]>([]);
  const [procedureCodes, setProcedureCodes] = useState<AttachedProcedureCode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [diagnosis, procedures] = await Promise.all([
        getDiagnosisCodesForTooth(patientId, tooth),
        getProcedureCodesForTooth(patientId, tooth),
      ]);

      if (cancelled) return;

      setDiagnosisCodes(
        diagnosis.map((row) => ({ key: row.id, existingId: row.id, code: row.clinical_codes }))
      );
      setProcedureCodes(
        procedures.map((row) => ({
          key: row.id,
          existingId: row.id,
          code: row.clinical_codes,
          modifiers: row.modifiers.map((m) => ({
            key: m.id,
            existingId: m.id,
            modifierCode: m.modifier_code,
            modifierDescription: m.modifier_description,
          })),
        }))
      );
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, tooth]);

  if (!loaded || (diagnosisCodes.length === 0 && procedureCodes.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Current Diagnosis &amp; Procedure Codes
      </h4>

      {diagnosisCodes.length > 0 && <CodedDiagnosisList codes={diagnosisCodes} readOnly />}
      {procedureCodes.length > 0 && <CodedProcedureList codes={procedureCodes} readOnly />}
    </div>
  );
}

export default function ToothHistoryTab({
  patientId,
  tooth,
  history,
}: Props) {
  if (history.length === 0) {
    return (
      <div className="space-y-5">
        <CurrentCoding patientId={patientId} tooth={tooth} />

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
      </div>
    );
  }

  return (
    <div className="space-y-5">

      <CurrentCoding patientId={patientId} tooth={tooth} />

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
