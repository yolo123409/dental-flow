"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Card from "@/components/ui/Card";

import ToothDetails from "./ToothDetails";
import DentalOdontogram from "@/components/dental/DentalOdontogram";

import { getPatientTeeth } from "@/services/patientTeeth";

import { PatientTooth } from "@/types";

interface Props {
  patientId: string;

  /** Externally-requested tooth to focus (e.g. from the Treatment
   * Plans tab). Purely additive - internal click-to-select behavior
   * is unchanged when this is omitted. */
  focusTooth?: number | null;

  /** Called with the currently selected tooth when the user wants to
   * add it to a treatment plan. Omit to hide that entry point. */
  onAddToTreatmentPlan?: (tooth: number) => void;
}

export default function DentalChart({
  patientId,
  focusTooth,
  onAddToTreatmentPlan,
}: Props) {
  const [selectedTooth, setSelectedTooth] =
    useState<number | null>(null);

  useEffect(() => {
    if (focusTooth != null) {
      setSelectedTooth(focusTooth);
    }
  }, [focusTooth]);

  const [teeth, setTeeth] =
    useState<PatientTooth[]>([]);

  const [loading, setLoading] =
    useState(true);

  const loadTeeth = useCallback(async () => {
    try {
      setLoading(true);

      const data =
        await getPatientTeeth(patientId);

      setTeeth(data ?? []);
    } catch (error) {
      console.error(
        "Failed to load teeth:",
        error
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadTeeth();
  }, [loadTeeth]);

  const toothMap = useMemo(() => {
    const map: Record<number, PatientTooth> = {};

    teeth.forEach((tooth) => {
      map[tooth.tooth_number] = tooth;
    });

    return map;
  }, [teeth]);

  const selectedToothData =
    useMemo<PatientTooth | null>(() => {
      if (!selectedTooth) {
        return null;
      }

      return (
        toothMap[selectedTooth] ?? null
      );
    }, [selectedTooth, toothMap]);

  return (
    <Card title="Dental Chart">

      {loading ? (

        <div className="flex h-80 items-center justify-center">

          <p className="text-slate-500">
            Loading dental chart...
          </p>

        </div>

      ) : (

        <div className="grid gap-8 lg:grid-cols-3">

          {/* Left */}

          <div className="space-y-6 lg:col-span-2">

            <DentalOdontogram
              teeth={teeth}
              selectedTooth={selectedTooth}
              onToothClick={setSelectedTooth}
            />

          </div>

          {/* Right */}

          <div>

            {selectedTooth ? (

              <ToothDetails
                patientId={patientId}
                tooth={selectedTooth}
                data={selectedToothData}
                onSaved={loadTeeth}
                onAddToTreatmentPlan={
                  onAddToTreatmentPlan
                    ? () =>
                        onAddToTreatmentPlan(
                          selectedTooth
                        )
                    : undefined
                }
              />

            ) : (

              <div className="flex min-h-[500px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center">

                <div>

                  <div className="mb-4 text-6xl">
                    🦷
                  </div>

                  <h3 className="text-xl font-semibold">
                    No Tooth Selected
                  </h3>

                  <p className="mt-3 text-slate-500">
                    Click any tooth to view or edit
                    its condition, diagnosis,
                    treatment and clinical notes.
                  </p>

                </div>

              </div>

            )}

          </div>

        </div>

      )}

    </Card>
  );
}