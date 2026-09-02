"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentSelect from "@/components/treatments/TreatmentSelect";

import ClinicalCodePicker from "@/components/clinical/ClinicalCodePicker";
import CodedProcedureList from "@/components/clinical/CodedProcedureList";
import CodedDiagnosisList from "@/components/clinical/CodedDiagnosisList";

import TreatmentMaterialsUsed from "./TreatmentMaterialsUsed";

import {
  ClinicalCodingUnavailableError,
  addPatientProcedureCode,
  addProcedureCodeModifier,
  getDiagnosisCodesForTooth,
  getProcedureCodesForTreatmentPlanItem,
  removePatientProcedureCode,
  removeProcedureCodeModifier,
} from "@/services/clinicalCodes";

import {
  AttachedDiagnosisCode,
  AttachedProcedureCode,
  ClinicalCode,
} from "@/types/clinicalCodes";

import { isValidTooth } from "@/components/patients/dental/toothSelection";
import {
  addTreatmentDeposit,
  getItemTeeth,
  isItemInvoiced,
  removeTreatmentDeposit,
} from "@/services/treatmentPlans";
import { getSafeErrorMessage } from "@/lib/logError";

import {
  TreatmentItemPriority,
  TreatmentItemStatus,
  TreatmentPlanItem,
  SaveTreatmentItemInput,
} from "@/types/treatmentPlan";

interface Props {
  open: boolean;

  item?: TreatmentPlanItem | null;

  /** Needed to attach CDT/CPT procedure codes and to read tooth-level
   * diagnosis context - see TreatmentItemCoding / TreatmentDiagnosisContext. */
  patientId: string;

  /** Prefilled when opened from a selected tooth on the odontogram. */
  defaultToothNumber?: number | null;

  /** For formatting Materials Used costs - see TreatmentMaterialsUsed.
   * Optional (defaults to "KES") so existing callers/tests that predate
   * FIN-2 don't need to pass it just to render the modal. */
  currency?: string;

  saving?: boolean;

  onClose: () => void;

  onSave: (
    values: SaveTreatmentItemInput
  ) => Promise<void>;
}

const EMPTY_FORM: SaveTreatmentItemInput = {
  procedure: "",
  tooth_numbers: [],
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
 * Phase D: a Treatment's teeth, editable here as chips - the Treatment
 * Plan tab's counterpart to the odontogram's own tooth selection
 * (BulkTreatmentModal), for a dentist who starts from "+ Add Treatment"
 * instead of the chart. Supports zero teeth (a treatment that genuinely
 * isn't tooth-specific - a consultation, a general exam), one, or many,
 * all through the same editor - see toothSelection.ts#isValidTooth for
 * what "valid" means here (real FDI codes, not a 1-32 range).
 *
 * Locked read-only once the Treatment has been invoiced (charge_id set) -
 * changing which teeth an invoiced line covers would silently change the
 * financial meaning of a charge that already exists (Phase D section 12);
 * the update_treatment_teeth RPC enforces this too, but disabling the
 * control here gives a clear reason instead of a failed save.
 */
function ToothNumbersEditor({
  toothNumbers,
  onChange,
  disabled,
}: {
  toothNumbers: number[];
  onChange: (teeth: number[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addTooth() {
    if (draft.trim() === "") return;

    const value = Number(draft);

    if (!Number.isInteger(value) || !isValidTooth(value)) {
      toast.error(
        "Tooth number must be a real FDI tooth number (11-18, 21-28, 31-38, or 41-48)."
      );
      return;
    }

    if (!toothNumbers.includes(value)) {
      onChange([...toothNumbers, value].sort((a, b) => a - b));
    }

    setDraft("");
  }

  function removeTooth(tooth: number) {
    onChange(toothNumbers.filter((existing) => existing !== tooth));
  }

  return (
    <div>
      <label className="mb-2 block font-medium">Teeth (optional)</label>

      {toothNumbers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {toothNumbers.map((tooth) => (
            <span
              key={tooth}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
            >
              🦷 {tooth}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTooth(tooth)}
                  aria-label={`Remove tooth ${tooth}`}
                  className="text-slate-400 transition hover:text-red-600"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {disabled ? (
        <p className="text-xs text-slate-400">
          This treatment has already been invoiced, so its teeth can no
          longer be changed.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTooth();
                }
              }}
              placeholder="e.g. 16"
              className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
            />

            <button
              type="button"
              onClick={addTooth}
              aria-label="Add tooth"
              className="shrink-0 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
            >
              Add
            </button>
          </div>

          {toothNumbers.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              Leave empty for a treatment that isn&apos;t tooth-specific
              (e.g. a consultation).
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Phase E (section 2/21): read-only context, not an editable field - what
 * is wrong with this tooth (diagnosis, recorded via ICD-10-CM on
 * patient_diagnosis_codes) stays visually near what is being done about it
 * (this Treatment) without merging the two concepts into one record.
 * Diagnosis remains keyed to a tooth, not to a treatment_plan_item (see
 * migration 0054) - editing it still only happens in Tooth Details /
 * TreatmentForm. Only shown for a single-tooth Treatment, since a grouped
 * or tooth-less Treatment has no one tooth's diagnosis to show.
 */
function TreatmentDiagnosisContext({
  patientId,
  toothNumber,
}: {
  patientId: string;
  toothNumber: number;
}) {
  const [codes, setCodes] = useState<AttachedDiagnosisCode[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const rows = await getDiagnosisCodesForTooth(patientId, toothNumber);

      if (cancelled) return;

      setCodes(
        rows.map((row) => ({
          key: row.id,
          existingId: row.id,
          code: row.clinical_codes,
        }))
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, toothNumber]);

  if (codes === null) return null;

  return (
    <div>
      <label className="mb-2 block font-medium">
        Diagnosis (Tooth {toothNumber})
      </label>

      {codes.length === 0 ? (
        <p className="text-xs text-slate-400">
          No diagnosis recorded for this tooth yet - add one from Tooth
          Details on the Dental Chart.
        </p>
      ) : (
        <CodedDiagnosisList codes={codes} readOnly />
      )}
    </div>
  );
}

/**
 * CDT/CPT procedure coding for an existing treatment - clinical metadata
 * only (a real, distinct clinical-coding concept - see ClinicalCodePicker),
 * completely independent of the treatment's name/tooth/price fields and of
 * the surrounding modal's own Save/Add submit flow. Only shown once the
 * item itself has a real id (i.e. when editing, never while creating)
 * since patient_procedure_codes.treatment_plan_item_id needs a real row to
 * point at. Each add/remove here writes immediately - there's no separate
 * "save" step for coding, since there's no natural moment to defer it to
 * that doesn't involve changing how the treatment itself saves.
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

/**
 * Billing audit fix #3: splits a treatment's single Pending charge into a
 * deposit + balance, reusing the exact existing charge -> invoice
 * pipeline. Self-contained and writes immediately, the same established
 * pattern as TreatmentMaterialsUsed/TreatmentItemCoding above - not part
 * of the surrounding form's own Save flow, since a deposit is a distinct
 * financial action, not a clinical/pricing edit.
 *
 * Only offered for a treatment that has a real charge and hasn't been
 * invoiced yet - once any part of it is billed, the amounts are
 * financial history and add_treatment_deposit()/remove_treatment_
 * deposit() (migration 0112) reject exactly that.
 */
function TreatmentDepositSplit({
  item,
  currency,
  onChanged,
}: {
  item: TreatmentPlanItem;
  currency: string;
  onChanged: (updated: TreatmentPlanItem) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  async function handleAddDeposit() {
    const amount = Number(depositAmount);

    if (!(amount > 0)) {
      toast.error("Enter a deposit amount greater than zero.");
      return;
    }

    try {
      setSaving(true);

      const updated = await addTreatmentDeposit(item.id, amount);

      onChanged(updated);
      setShowForm(false);
      setDepositAmount("");
      toast.success("Split into a deposit and balance.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to add a deposit."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveDeposit() {
    try {
      setSaving(true);

      const updated = await removeTreatmentDeposit(item.id);

      onChanged(updated);
      toast.success("Deposit and balance merged back into one charge.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to undo the split."));
    } finally {
      setSaving(false);
    }
  }

  if (item.deposit_charge_id) {
    const depositStatus = item.deposit_charge?.status ?? "Pending";
    const balanceStatus = item.clinic_charges?.status ?? "Pending";
    const canUndo = depositStatus === "Pending" && balanceStatus === "Pending";

    return (
      <div className="space-y-2 border-t pt-4">
        <label className="mb-1 block font-medium">Payment Plan</label>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
          <span>
            Deposit{" "}
            {item.deposit_charge && (
              <span className="text-slate-500">
                ({formatMoney(Number(item.deposit_charge.amount))})
              </span>
            )}
          </span>
          <span className="font-medium text-slate-600">{depositStatus}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
          <span>
            Balance{" "}
            {item.clinic_charges && (
              <span className="text-slate-500">
                ({formatMoney(Number(item.clinic_charges.amount))})
              </span>
            )}
          </span>
          <span className="font-medium text-slate-600">{balanceStatus}</span>
        </div>

        {canUndo && (
          <button
            type="button"
            onClick={handleRemoveDeposit}
            disabled={saving}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            {saving ? "Please wait..." : "Undo split"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <label className="mb-1 block font-medium">
        Payment Plan <span className="font-normal text-slate-400">(optional)</span>
      </label>

      {showForm ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormInput
              label="Deposit amount"
              type="number"
              value={depositAmount}
              onChange={setDepositAmount}
            />
          </div>

          <button
            type="button"
            onClick={handleAddDeposit}
            disabled={saving}
            className="h-11.5 shrink-0 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
          >
            {saving ? "Saving..." : "Split"}
          </button>

          <button
            type="button"
            onClick={() => setShowForm(false)}
            disabled={saving}
            className="h-11.5 shrink-0 px-2 text-sm text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
        >
          + Split into deposit &amp; balance
        </button>
      )}
    </div>
  );
}

export default function TreatmentItemModal({
  open,
  item,
  patientId,
  defaultToothNumber,
  currency = "KES",
  saving = false,
  onClose,
  onSave,
}: Props) {
  const editing = item != null;

  // Phase D section 12: teeth are frozen once a Treatment has been
  // invoiced - see ToothNumbersEditor and update_treatment_teeth (0077).
  // Phase H: uses isItemInvoiced(), not raw charge_id - every billable
  // Treatment now gets a charge immediately on creation, while still
  // Pending, and update_treatment_teeth (migration 0080) correctly
  // allows editing a Pending item's teeth; this client-side check must
  // match that exactly, or the UI locks itself out of an edit the server
  // would actually allow.
  const teethLocked = editing && item != null && isItemInvoiced(item);

  const [form, setForm] =
    useState<SaveTreatmentItemInput>(EMPTY_FORM);

  // Mirrors `item`, but updated locally the moment a deposit is
  // added/removed (TreatmentDepositSplit writes immediately, outside the
  // form's own Save flow) - so the split state shown here doesn't go
  // stale until the modal happens to be reopened.
  const [liveItem, setLiveItem] = useState<TreatmentPlanItem | null>(
    item ?? null
  );

  // Phase E section 1/D: explicit catalogue-vs-custom toggle, matching
  // the pattern already proven in BulkTreatmentModal/TreatmentForm -
  // fixes the Phase D gap where typing a name that didn't match a
  // catalogue suggestion never actually committed to form.procedure.
  const [customTreatment, setCustomTreatment] = useState(false);

  useEffect(() => {
    if (!open) return;

    setCustomTreatment(false);
    setLiveItem(item ?? null);

    if (item) {
      setForm({
        procedure: item.procedure,
        tooth_numbers: getItemTeeth(item),
        estimated_price: item.estimated_price,
        quantity: item.quantity,
        notes: item.notes,
        priority: item.priority,
        status: item.status,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        tooth_numbers: defaultToothNumber != null ? [defaultToothNumber] : [],
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
      toast.error("Please choose a treatment.");
      return;
    }

    for (const tooth of form.tooth_numbers) {
      if (!isValidTooth(tooth)) {
        toast.error(
          "Tooth number must be a real FDI tooth number (11-18, 21-28, 31-38, or 41-48)."
        );
        return;
      }
    }

    await onSave(form);
  }

  return (
    <FormModal
      open={open}
      title={
        editing ? "Edit Treatment" : "Add Treatment"
      }
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={editing ? "Save Changes" : "Add"}
    >
      {!customTreatment && (
        <TreatmentSelect
          value={form.procedure}
          onChange={(name, price) => {
            update("procedure", name);
            update("estimated_price", price);
          }}
        />
      )}

      <div className="flex items-center gap-3">
        <input
          id="item-custom-treatment"
          type="checkbox"
          checked={customTreatment}
          onChange={(e) => setCustomTreatment(e.target.checked)}
        />

        <label htmlFor="item-custom-treatment" className="text-sm">
          Custom Treatment
        </label>
      </div>

      <FormInput
        label="Treatment"
        value={form.procedure}
        placeholder="e.g. Composite Restoration"
        onChange={(value) => update("procedure", value)}
      />

      <ToothNumbersEditor
        toothNumbers={form.tooth_numbers}
        onChange={(teeth) => update("tooth_numbers", teeth)}
        disabled={teethLocked}
      />

      {form.tooth_numbers.length === 1 && (
        <TreatmentDiagnosisContext
          patientId={patientId}
          toothNumber={form.tooth_numbers[0]}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        {form.tooth_numbers.length > 0 ? (
          <div>
            <label className="mb-2 block font-medium">
              Quantity
            </label>

            <div className="flex h-11.5 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
              {form.tooth_numbers.length}{" "}
              {form.tooth_numbers.length === 1 ? "tooth" : "teeth"}
            </div>
          </div>
        ) : (
          <FormInput
            label="Quantity"
            type="number"
            value={form.quantity}
            disabled={teethLocked}
            onChange={(value) =>
              update(
                "quantity",
                Math.max(1, Number(value) || 1)
              )
            }
          />
        )}

        <FormInput
          label="Estimated Price"
          type="number"
          value={form.estimated_price}
          disabled={teethLocked}
          onChange={(value) =>
            update(
              "estimated_price",
              Math.max(0, Number(value) || 0)
            )
          }
        />
      </div>

      {/* Full-app audit fix H1: price/quantity had no lock at all once a
          treatment was invoiced, unlike the teeth editor right next to it
          (its own "already been invoiced" message is above) - editing
          either afterward silently desynced them from the real, frozen
          clinic_charges.amount, and TreatmentPlanDetail's own "Invoiced"
          stat used to read straight from these editable fields as a
          result (also fixed - it now sums the real charge amounts). */}
      {teethLocked && (
        <p className="text-xs text-slate-400">
          This treatment has already been invoiced, so its price and
          quantity can no longer be changed.
        </p>
      )}

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
        <>
          {liveItem &&
            liveItem.charge_id &&
            liveItem.status !== "Cancelled" &&
            (liveItem.deposit_charge_id || !isItemInvoiced(liveItem)) && (
              <TreatmentDepositSplit
                item={liveItem}
                currency={currency}
                onChanged={setLiveItem}
              />
            )}

          <TreatmentMaterialsUsed
            treatmentPlanItemId={item.id}
            currency={currency}
          />

          <TreatmentItemCoding
            patientId={patientId}
            itemId={item.id}
            // CDT/CPT codes tag a single tooth (see clinicalCodes.ts) - only
            // offered when this Treatment has exactly one, never guessed
            // from a multi-tooth or tooth-less Treatment's set.
            toothNumber={
              form.tooth_numbers.length === 1 ? form.tooth_numbers[0] : null
            }
          />
        </>
      ) : (
        <p className="border-t pt-4 text-xs text-slate-400">
          Save this treatment first, then reopen it here to record materials used or add a CDT/CPT procedure code.
        </p>
      )}
    </FormModal>
  );
}
