"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import FormTextarea from "@/components/ui/FormTextarea";
import { saveTooth } from "@/services/patientTeeth";

const conditions = [
  "Healthy",
  "Caries",
  "Filling",
  "Crown",
  "Implant",
  "Missing",
];

interface Props {
  patientId: string;
  tooth: number;
  data?: any;
  onSaved: () => void;
}

export default function ToothDetails({
  patientId,
  tooth,
  data,
  onSaved,
}: Props) {
  const [condition, setCondition] = useState("Healthy");
  const [diagnosis, setDiagnosis] = useState("");
  const [treatment, setTreatment] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCondition(data?.condition ?? "Healthy");
    setDiagnosis(data?.diagnosis ?? "");
    setTreatment(data?.treatment ?? "");
    setNotes(data?.notes ?? "");
  }, [data]);

  async function handleSave() {
    try {
      setSaving(true);

      await saveTooth({
        patient_id: patientId,
        tooth_number: tooth,
        condition,
        diagnosis,
        treatment,
        notes,
      });

      onSaved();

    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={`Tooth #${tooth}`}>

      <div className="space-y-5">

        <div>

          <label className="mb-2 block text-sm font-medium">
            Condition
          </label>

          <select
            value={condition}
            onChange={(e) =>
              setCondition(e.target.value)
            }
            className="w-full rounded-xl border border-slate-200 p-3"
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
  onChange={setDiagnosis}
/>

<FormTextarea
  label="Treatment"
  value={treatment}
  onChange={setTreatment}
/>

<FormTextarea
  label="Clinical Notes"
  value={notes}
  onChange={setNotes}
/>

        <Button
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Tooth"}
        </Button>

      </div>

    </Card>
  );
}