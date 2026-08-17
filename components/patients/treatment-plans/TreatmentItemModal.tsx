"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentSelect from "@/components/treatments/TreatmentSelect";

import ClinicalCodePicker from "@/components/clinical/ClinicalCodePicker";
import CodedProcedureList from "@/components/clinical/CodedProcedureList";

import {
  ClinicalCodingUnavailableError,
  addPatientProcedureCode,
  addProcedureCodeModifier,
  getProcedureCodesForTreatmentPlanItem,
  removePatientProcedureCode,
  removeProcedureCodeModifier,
} from "@/services/clinicalCodes";

import { AttachedProcedureCode, ClinicalCode } from "@/types/clinicalCodes";

import {
  TreatmentItemPriority,
  TreatmentItemStatus,
  TreatmentPlanItem,
  SaveTreatmentItemInput,
} from "@/types/treatmentPlan";

interface Props {
  open: boolean;

  item?: TreatmentPlanItem | null;

  /** Needed to attach CDT/CPT procedure codes to the correct patient - see TreatmentItemCoding. */
  patientId: string;

  /** Prefilled when opened from a selected tooth on the odontogram. */
  defaultToothNumber?: number | null;

  saving?: boolean;

  onClose: () => void;

  onSave: (
    values: SaveTreatmentItemInput
  ) => Promise<void>;
}

const EMPTY_FORM: SaveTreatmentItemInput = {
  procedure: "",
  tooth_number: null,
  estimated_price: 0,
  quantity: 1,
  notes: null,
  priority: "Medium",
  status: "Planned",
};

function newTempKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random()}`;
}

/**
 * CDT/CPT procedure coding for an existing treatment plan item -
 * clinical metadata only, completely independent of the item's
 * procedure/tooth/price fields and of the surrounding modal's own
 * Save/Add submit flow. Only shown once the item itself has a real id
 * (i.e. when editing, never while creating) since
 * patient_procedure_codes.treatment_plan_item_id needs a real row to
 * point at. Each add/remove here writes immediately - there's no
 * separate "save" step for coding, since there's no natural moment to
 * defer it to that doesn't involve changing how the item itself saves.
 */
function TreatmentItemCoding({
  patientId,
  itemId,
  toothNumber,
}: {
  patientId: string;
  itemId: string;
  toothNumber: number | null;
}) {
  const [codes, setCodes] = useState<AttachedProcedureCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCptPicker, setShowCptPicker] = useState(false);

  async function load() {
    const rows = await getProcedureCodesForTreatmentPlanItem(itemId);

    setCodes(
      rows.map((row) => ({
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
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function handleSelect(code: ClinicalCode) {
    if (codes.some((item) => item.code.id === code.id)) return;

    try {
      await addPatientProcedureCode({
        patientId,
        codeId: code.id,
        toothNumber,
        treatmentPlanItemId: itemId,
      });

      await load();
    } catch (error) {
      toast.error(
        error instanceof ClinicalCodingUnavailableError
          ? error.message
          : "Failed to save procedure code."
      );
    }

    setShowCptPicker(false);
  }

  async function handleRemove(key: string) {
    const target = codes.find((item) => item.key === key);
    if (!target?.existingId) return;

    try {
      await removePatientProcedureCode(target.existingId);
      await load();
    } catch (error) {
      toast.error(
        error instanceof ClinicalCodingUnavailableError
          ? error.message
          : "Failed to remove procedure code."
      );
    }
  }

  async function handleAddModifier(procedureKey: string, modifierCode: string, modifierDescription: string | null) {
    const target = codes.find((item) => item.key === procedureKey);
    if (!target?.existingId) return;

    try {
      await addProcedureCodeModifier(target.existingId, modifierCode, modifierDescription);
      await load();
    } catch (error) {
      toast.error(
        error instanceof ClinicalCodingUnavailableError
          ? error.message
          : "Failed to save modifier."
      );
    }
  }

  async function handleRemoveModifier(_procedureKey: string, modifierKey: string) {
    try {
      await removeProcedureCodeModifier(modifierKey);
      await load();
    } catch (error) {
      toast.error(
        error instanceof ClinicalCodingUnavailableError
          ? error.message
          : "Failed to remove modifier."
      );
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-2 border-t pt-4">
      <label className="mb-1 block font-medium">
        CDT Procedure Code <span className="font-normal text-slate-400">(optional, saves immediately)</span>
      </label>

      <CodedProcedureList
        codes={codes}
        onRemove={handleRemove}
        onAddModifier={handleAddModifier}
        onRemoveModifier={handleRemoveModifier}
      />

      <ClinicalCodePicker codeSystem="CDT" placeholder="Search CDT procedure codes..." onSelect={handleSelect} />

      <div className="mt-2">
        {showCptPicker ? (
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-600">Medical Procedure Code (CPT)</label>
            <ClinicalCodePicker
              codeSystem="CPT"
              placeholder="Search CPT medical procedure codes..."
              onSelect={handleSelect}
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
  );
}

export default function TreatmentItemModal({
  open,
  item,
  patientId,
  defaultToothNumber,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const editing = item != null;

  const [form, setForm] =
    useState<SaveTreatmentItemInput>(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;

    if (item) {
      setForm({
        procedure: item.procedure,
        tooth_number: item.tooth_number,
        estimated_price: item.estimated_price,
        quantity: item.quantity,
        notes: item.notes,
        priority: item.priority,
        status: item.status,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        tooth_number: defaultToothNumber ?? null,
      });
    }
  }, [open, item, defaultToothNumber]);

  function update<K extends keyof SaveTreatmentItemInput>(
    field: K,
    value: SaveTreatmentItemInput[K]
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.procedure.trim()) {
      toast.error("Please choose a procedure.");
      return;
    }

    if (
      form.tooth_number != null &&
      (form.tooth_number < 1 || form.tooth_number > 32)
    ) {
      toast.error("Tooth number must be between 1 and 32.");
      return;
    }

    await onSave(form);
  }

  return (
    <FormModal
      open={open}
      title={
        editing ? "Edit Procedure" : "Add Procedure"
      }
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={editing ? "Save Changes" : "Add"}
    >
      <TreatmentSelect
        value={form.procedure}
        onChange={(name, price) => {
          update("procedure", name);
          update("estimated_price", price);
        }}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Tooth Number (optional)"
          type="number"
          value={form.tooth_number ?? ""}
          placeholder="1-32"
          onChange={(value) =>
            update(
              "tooth_number",
              value === "" ? null : Number(value)
            )
          }
        />

        <FormInput
          label="Quantity"
          type="number"
          value={form.quantity}
          onChange={(value) =>
            update(
              "quantity",
              Math.max(1, Number(value) || 1)
            )
          }
        />
      </div>

      <FormInput
        label="Estimated Price"
        type="number"
        value={form.estimated_price}
        onChange={(value) =>
          update(
            "estimated_price",
            Math.max(0, Number(value) || 0)
          )
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block font-medium">
            Priority
          </label>

          <select
            value={form.priority}
            onChange={(e) =>
              update(
                "priority",
                e.target.value as TreatmentItemPriority
              )
            }
            className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block font-medium">
            Status
          </label>

          <select
            value={form.status}
            onChange={(e) =>
              update(
                "status",
                e.target.value as TreatmentItemStatus
              )
            }
            className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
          >
            <option value="Planned">Planned</option>
            <option value="In Progress">
              In Progress
            </option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <FormTextarea
        label="Notes"
        value={form.notes ?? ""}
        onChange={(value) =>
          update("notes", value || null)
        }
      />

      {editing && item ? (
        <TreatmentItemCoding patientId={patientId} itemId={item.id} toothNumber={form.tooth_number} />
      ) : (
        <p className="border-t pt-4 text-xs text-slate-400">
          Save this procedure first, then reopen it here to add a CDT/CPT procedure code.
        </p>
      )}
    </FormModal>
  );
}
