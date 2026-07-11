"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Card from "@/components/ui/Card";

import DentalArch from "./DentalArch";
import ToothDetails from "./ToothDetails";

import {
  upperTeeth,
  lowerTeeth,
} from "./toothData";

import { getPatientTeeth } from "@/services/patientTeeth";

import { PatientTooth } from "@/types";

interface Props {
  patientId: string;
}

export default function DentalChart({
  patientId,
}: Props) {
  const [selectedTooth, setSelectedTooth] =
    useState<number | null>(null);

  const [teeth, setTeeth] =
  useState<PatientTooth[]>([]);

  const [loading, setLoading] =
    useState(true);

  const loadTeeth = useCallback(async () => {
    try {
      setLoading(true);

      const data = await getPatientTeeth(patientId);

      setTeeth(data ?? []);
    } catch (error) {
      console.error("Failed to load teeth:", error);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadTeeth();
  }, [loadTeeth]);

  const selectedToothData = useMemo<PatientTooth | null>(() => {
  if (!selectedTooth) return null;

  return (
    teeth.find(
      (tooth) => tooth.tooth_number === selectedTooth
    ) ?? null
  );
}, [selectedTooth, teeth]);

  return (
    <Card title="Dental Chart">

      {loading ? (

        <div className="flex h-72 items-center justify-center">

          <p className="text-slate-500">
            Loading dental chart...
          </p>

        </div>

      ) : (

        <div className="space-y-10">

          <div>

            <h3 className="mb-5 text-center text-lg font-semibold">
              Upper Arch
            </h3>

            <DentalArch
              teeth={upperTeeth}
              selected={selectedTooth}
              onSelect={setSelectedTooth}
            />

          </div>

          <div>

            <h3 className="mb-5 text-center text-lg font-semibold">
              Lower Arch
            </h3>

            <DentalArch
              teeth={lowerTeeth}
              selected={selectedTooth}
              onSelect={setSelectedTooth}
            />

          </div>

          {selectedTooth && (

            <ToothDetails
              patientId={patientId}
              tooth={selectedTooth}
              data={selectedToothData}
              onSaved={loadTeeth}
            />

          )}

        </div>

      )}

    </Card>
  );
}