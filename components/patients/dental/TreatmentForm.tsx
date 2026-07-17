"use client";

import { useEffect, useState } from "react";

import {
  ToothCondition,
  TreatmentStatus,
  SavePatientTooth,
} from "@/types";

import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentPicker from "@/components/treatments/TreatmentPicker";


const conditions: ToothCondition[] = [
  "Healthy",
  "Caries",
  "Filling",
  "Crown",
  "Implant",
  "Missing",
];

const statuses: TreatmentStatus[] = [
  "Planned",
  "In Progress",
  "Completed",
  "Referred",
  "Cancelled",
];

interface Props {
  patientId: string;

  tooth: number;

  initialValues: {
    condition: ToothCondition;

    diagnosis: string;

    treatment: string;

    treatment_status: TreatmentStatus | null;

    materials: string | null;

    estimated_cost: number | null;

    notes: string;
  };

  saving: boolean;

  onSave: (
    data: SavePatientTooth
  ) => Promise<void>;
}

export default function TreatmentForm({
  patientId,
  tooth,
  initialValues,
  saving,
  onSave,
}: Props) {
  const [condition, setCondition] =
    useState<ToothCondition>("Healthy");

  const [diagnosis, setDiagnosis] =
    useState("");

  const [treatment, setTreatment] =
    useState("");

    const [
  customTreatment,
  setCustomTreatment,
] = useState(false);

  const [status, setStatus] =
    useState<TreatmentStatus>("Planned");

  const [materials, setMaterials] =
    useState("");

  const [cost, setCost] =
    useState("");

  const [notes, setNotes] =
    useState("");

  useEffect(() => {
    setCondition(initialValues.condition);

    setDiagnosis(
      initialValues.diagnosis
    );

    setTreatment(
      initialValues.treatment
    );

    setStatus(
      initialValues.treatment_status ??
        "Planned"
    );

    setMaterials(
      initialValues.materials ?? ""
    );

    setCost(
      initialValues.estimated_cost != null
        ? String(
            initialValues.estimated_cost
          )
        : ""
    );

    setNotes(initialValues.notes);
  }, [initialValues]);

  async function handleSubmit() {
    await onSave({
      patient_id: patientId,

      tooth_number: tooth,

      condition,

      diagnosis,

      treatment,

      treatment_status: status,

      materials,

      estimated_cost:
        cost === ""
          ? null
          : Number(cost),

      notes,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium">
          Condition
        </label>

        <select
          value={condition}
          onChange={(e) =>
            setCondition(
              e.target
                .value as ToothCondition
            )
          }
          className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
        >
          {conditions.map((item) => (
            <option
              key={item}
              value={item}
            >
              {item}
            </option>
          ))}
        </select>
      </div>

      <FormTextarea
        label="Diagnosis"
        value={diagnosis}
        rows={3}
        onChange={setDiagnosis}
      />

      {!customTreatment && (

  <TreatmentPicker
    onSelect={(
      selectedTreatment,
      price
    ) => {

      setTreatment(
        selectedTreatment
      );

      setCost(
        String(price)
      );

    }}
  />

)}

<div className="flex items-center gap-3">

  <input
    id="custom-treatment"
    type="checkbox"
    checked={
      customTreatment
    }
    onChange={(e) =>
      setCustomTreatment(
        e.target.checked
      )
    }
  />

  <label
    htmlFor="custom-treatment"
    className="text-sm"
  >
    Custom Treatment
  </label>

</div>

<FormTextarea
  label="Treatment Performed"
  value={treatment}
  rows={3}
  onChange={setTreatment}
/>

      <div>
        <label className="mb-2 block text-sm font-medium">
          Treatment Status
        </label>

        <select
          value={status}
          onChange={(e) =>
            setStatus(
              e.target
                .value as TreatmentStatus
            )
          }
          className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
        >
          {statuses.map((item) => (
            <option
              key={item}
              value={item}
            >
              {item}
            </option>
          ))}
        </select>
      </div>

      <FormTextarea
        label="Materials Used"
        value={materials}
        rows={3}
        onChange={setMaterials}
      />

      <FormInput
        label="Estimated Cost"
        type="number"
        value={cost}
        placeholder="0.00"
        onChange={setCost}
      />

      <FormTextarea
        label="Clinical Notes"
        value={notes}
        rows={5}
        onChange={setNotes}
      />

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving
            ? "Saving..."
            : "Save Treatment"}
        </Button>
      </div>
    </div>
  );
}