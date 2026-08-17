"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  ToothCondition,
  TreatmentStatus,
  SavePatientTooth,
} from "@/types";

import { AttachedDiagnosisCode, AttachedProcedureCode, ClinicalCode } from "@/types/clinicalCodes";

import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentPicker from "@/components/treatments/TreatmentPicker";
import ClinicalCodePicker from "@/components/clinical/ClinicalCodePicker";
import CodedDiagnosisList from "@/components/clinical/CodedDiagnosisList";
import CodedProcedureList from "@/components/clinical/CodedProcedureList";

import {
  ClinicalCodingUnavailableError,
  addPatientDiagnosisCode,
  addPatientProcedureCode,
  addProcedureCodeModifier,
  getDiagnosisCodesForTooth,
  getProcedureCodesForTooth,
  removePatientDiagnosisCode,
  removePatientProcedureCode,
  removeProcedureCodeModifier,
} from "@/services/clinicalCodes";

import { syncAttachedItems } from "@/lib/clinicalCodingSync";

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

function newTempKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random()}`;
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

  // Clinical coding - additive/optional, never replaces the free-text
  // fields above. Diagnosis codes are ICD-10-CM only; procedure codes
  // are CDT by default, with CPT available only via the explicit
  // secondary "Medical Procedure Code (CPT)" action.
  const [diagnosisCodes, setDiagnosisCodes] = useState<AttachedDiagnosisCode[]>([]);
  const [originalDiagnosisCodes, setOriginalDiagnosisCodes] = useState<AttachedDiagnosisCode[]>([]);
  const [procedureCodes, setProcedureCodes] = useState<AttachedProcedureCode[]>([]);
  const [originalProcedureCodes, setOriginalProcedureCodes] = useState<AttachedProcedureCode[]>([]);
  const [showCptPicker, setShowCptPicker] = useState(false);
  const [codingSaving, setCodingSaving] = useState(false);

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [loadedDiagnosisCodes, loadedProcedureCodes] = await Promise.all([
        getDiagnosisCodesForTooth(patientId, tooth),
        getProcedureCodesForTooth(patientId, tooth),
      ]);

      if (cancelled) return;

      const diagnosisAttached: AttachedDiagnosisCode[] = loadedDiagnosisCodes.map((row) => ({
        key: row.id,
        existingId: row.id,
        code: row.clinical_codes,
      }));

      const procedureAttached: AttachedProcedureCode[] = loadedProcedureCodes.map((row) => ({
        key: row.id,
        existingId: row.id,
        code: row.clinical_codes,
        modifiers: row.modifiers.map((m) => ({
          key: m.id,
          existingId: m.id,
          modifierCode: m.modifier_code,
          modifierDescription: m.modifier_description,
        })),
      }));

      setDiagnosisCodes(diagnosisAttached);
      setOriginalDiagnosisCodes(diagnosisAttached);
      setProcedureCodes(procedureAttached);
      setOriginalProcedureCodes(procedureAttached);
      setShowCptPicker(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, tooth]);

  function handleSelectDiagnosisCode(code: ClinicalCode) {
    if (diagnosisCodes.some((item) => item.code.id === code.id)) return;

    setDiagnosisCodes((prev) => [...prev, { key: newTempKey(), existingId: null, code }]);
  }

  function handleRemoveDiagnosisCode(key: string) {
    setDiagnosisCodes((prev) => prev.filter((item) => item.key !== key));
  }

  function handleSelectProcedureCode(code: ClinicalCode) {
    if (procedureCodes.some((item) => item.code.id === code.id)) return;

    setProcedureCodes((prev) => [...prev, { key: newTempKey(), existingId: null, code, modifiers: [] }]);
  }

  function handleRemoveProcedureCode(key: string) {
    setProcedureCodes((prev) => prev.filter((item) => item.key !== key));
  }

  function handleAddModifier(procedureKey: string, modifierCode: string, modifierDescription: string | null) {
    setProcedureCodes((prev) =>
      prev.map((item) =>
        item.key === procedureKey
          ? {
              ...item,
              modifiers: [
                ...item.modifiers,
                { key: newTempKey(), existingId: null, modifierCode, modifierDescription },
              ],
            }
          : item
      )
    );
  }

  function handleRemoveModifier(procedureKey: string, modifierKey: string) {
    setProcedureCodes((prev) =>
      prev.map((item) =>
        item.key === procedureKey
          ? { ...item, modifiers: item.modifiers.filter((m) => m.key !== modifierKey) }
          : item
      )
    );
  }

  /**
   * Runs only after the existing tooth save has already succeeded - a
   * coding failure here is reported separately and never undoes or
   * blocks the clinical save that already happened.
   */
  async function syncCoding() {
    setCodingSaving(true);

    try {
      await syncAttachedItems(
        diagnosisCodes,
        originalDiagnosisCodes,
        (item) => addPatientDiagnosisCode({ patientId, codeId: item.code.id, toothNumber: tooth }),
        (id) => removePatientDiagnosisCode(id)
      );

      const currentProcedureIds = new Set(
        procedureCodes.filter((p) => p.existingId).map((p) => p.existingId as string)
      );
      const removedProcedures = originalProcedureCodes.filter(
        (p) => p.existingId && !currentProcedureIds.has(p.existingId)
      );

      await Promise.all(removedProcedures.map((p) => removePatientProcedureCode(p.existingId as string)));

      for (const procedure of procedureCodes) {
        let procedureCodeId = procedure.existingId;

        if (!procedureCodeId) {
          procedureCodeId = await addPatientProcedureCode({
            patientId,
            codeId: procedure.code.id,
            toothNumber: tooth,
          });
        }

        const originalProcedure = originalProcedureCodes.find((p) => p.key === procedure.key);

        await syncAttachedItems(
          procedure.modifiers,
          originalProcedure?.modifiers ?? [],
          (modifier) =>
            addProcedureCodeModifier(procedureCodeId as string, modifier.modifierCode, modifier.modifierDescription).then(
              (row) => row.id
            ),
          (id) => removeProcedureCodeModifier(id)
        );
      }
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof ClinicalCodingUnavailableError
          ? error.message
          : "Treatment saved, but coding could not be saved."
      );
    } finally {
      setCodingSaving(false);
    }
  }

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

    await syncCoding();
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

      <div>
        <label className="mb-2 block text-sm font-medium">
          ICD-10-CM Diagnosis Code <span className="font-normal text-slate-400">(optional)</span>
        </label>

        <CodedDiagnosisList codes={diagnosisCodes} onRemove={handleRemoveDiagnosisCode} />

        <div className={diagnosisCodes.length > 0 ? "mt-2" : ""}>
          <ClinicalCodePicker
            codeSystem="ICD-10-CM"
            placeholder="Search ICD-10-CM diagnosis codes..."
            onSelect={handleSelectDiagnosisCode}
          />
        </div>
      </div>

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
          CDT Procedure Code <span className="font-normal text-slate-400">(optional)</span>
        </label>

        <CodedProcedureList
          codes={procedureCodes}
          onRemove={handleRemoveProcedureCode}
          onAddModifier={handleAddModifier}
          onRemoveModifier={handleRemoveModifier}
        />

        <div className={procedureCodes.length > 0 ? "mt-2" : ""}>
          <ClinicalCodePicker
            codeSystem="CDT"
            placeholder="Search CDT procedure codes..."
            onSelect={handleSelectProcedureCode}
          />
        </div>

        <div className="mt-2">
          {showCptPicker ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">
                Medical Procedure Code (CPT)
              </label>

              <ClinicalCodePicker
                codeSystem="CPT"
                placeholder="Search CPT medical procedure codes..."
                onSelect={(code) => {
                  handleSelectProcedureCode(code);
                  setShowCptPicker(false);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCptPicker(true)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
            >
              + Medical Procedure Code (CPT)
            </button>
          )}
        </div>
      </div>

      {codingSaving && (
        <p className="text-xs text-slate-400">Saving coding...</p>
      )}

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
