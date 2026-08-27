"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  ClinicInventoryItem,
  InventoryBatch,
  recordConsumption,
} from "@/services/inventory";
import { getPatientOptions } from "@/services/patients";
import { getTreatments, ClinicTreatment } from "@/services/treatments";
import { getSafeErrorMessage } from "@/lib/logError";

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface Props {
  open: boolean;

  material: ClinicInventoryItem | null;

  batches: InventoryBatch[];

  onClose: () => void;

  onSaved: () => Promise<void>;
}

const NONE = "";

export default function RecordConsumptionModal({
  open,
  material,
  batches,
  onClose,
  onSaved,
}: Props) {
  const [quantity, setQuantity] = useState("");
  const [batchNumber, setBatchNumber] = useState(NONE);
  const [patientId, setPatientId] = useState(NONE);
  const [treatmentId, setTreatmentId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [treatments, setTreatments] = useState<ClinicTreatment[]>([]);

  useEffect(() => {
    if (!open) return;

    setQuantity("");
    setBatchNumber(NONE);
    setPatientId(NONE);
    setTreatmentId(NONE);
    setNotes("");

    getPatientOptions()
      .then((data) => setPatients(data as PatientOption[]))
      .catch((error) => console.error(error));

    getTreatments()
      .then(setTreatments)
      .catch((error) => console.error(error));
  }, [open, material]);

  if (!open || !material) {
    return null;
  }

  const currentQuantity = Number(material.quantity);
  const parsedQuantity = Number(quantity || 0);

  async function handleSave() {
    if (!material) return;

    if (!quantity.trim() || parsedQuantity <= 0) {
      toast.error("Enter a quantity greater than 0.");
      return;
    }

    if (parsedQuantity > currentQuantity) {
      toast.error(
        `Cannot use more than the current stock (${currentQuantity} available).`
      );
      return;
    }

    try {
      setSaving(true);

      await recordConsumption(material.id, parsedQuantity, {
        notes: notes || undefined,
        patientId: patientId || null,
        treatmentId: treatmentId || null,
        batchNumber: batchNumber || null,
      });

      toast.success("Consumption recorded.");

      await onSaved();

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to record consumption.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Record Consumption - ${material.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Record Consumption"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Quantity Used"
            required
            type="number"
            value={quantity}
            onChange={setQuantity}
          />

          {batches.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-semibold text-graphite">
                Batch (optional)
              </label>

              <select
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
              >
                <option value={NONE}>Unspecified</option>
                {batches.map((batch) => (
                  <option
                    key={batch.batchNumber ?? "unbatched"}
                    value={batch.batchNumber ?? ""}
                  >
                    {batch.batchNumber ?? "Unbatched"} ({batch.quantityRemaining}{" "}
                    {material.unit} available)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Patient (optional)
            </label>

            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Not specified</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.first_name} {patient.last_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Treatment (optional)
            </label>

            <select
              value={treatmentId}
              onChange={(e) => setTreatmentId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Not specified</option>
              {treatments.map((treatment) => (
                <option key={treatment.id} value={treatment.id}>
                  {treatment.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-mineral">
          This is for general stock use (waste, damage, corrections). For material used on a
          specific patient's treatment plan, add it from that treatment plan instead - only that
          records a cost against the treatment itself for Treatment Profitability.
        </p>

        <FormTextarea label="Notes (optional)" value={notes} onChange={setNotes} />

        <div className="rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm text-graphite">
          <div className="flex items-center justify-center gap-2 text-base font-semibold">
            <span>{currentQuantity}</span>
            <span className="text-mineral">→</span>
            <span className="text-clay">
              {Math.max(currentQuantity - parsedQuantity, 0)}
            </span>
            <span className="text-mineral">{material.unit}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
