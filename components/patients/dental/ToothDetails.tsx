"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  PatientTooth,
  SavePatientTooth,
} from "@/types";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import TreatmentForm from "@/components/patients/dental/TreatmentForm";
import ToothHistoryTab, {
  HistoryItem,
} from "@/components/patients/dental/ToothHistoryTab";
import ToothAttachments from "@/components/dental/attachments/ToothAttachments";

import {
  getToothHistory,
  saveTooth,
} from "@/services/patientTeeth";

type Tab =
  | "details"
  | "history"
  | "attachments";

interface Props {
  patientId: string;

  tooth: number;

  selectedSurface?: string | null;

  data: PatientTooth | null;

  onSaved: () => Promise<void>;

  /** Omit to hide the "Add to Treatment Plan" entry point. */
  onAddToTreatmentPlan?: () => void;
}

export default function ToothDetails({
  patientId,
  tooth,
  selectedSurface,
  data,
  onSaved,
  onAddToTreatmentPlan,
}: Props) {
  const [activeTab, setActiveTab] =
    useState<Tab>("details");

  const [saving, setSaving] =
    useState(false);

  const [history, setHistory] =
    useState<HistoryItem[]>([]);

  useEffect(() => {
    loadHistory();
  }, [patientId, tooth]);

  async function loadHistory() {
    try {
      const result =
        await getToothHistory(
          patientId,
          tooth
        );

      setHistory(result);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleSave(
    values: SavePatientTooth
  ) {
    try {
      setSaving(true);

      await saveTooth(values);

      await onSaved();

      await loadHistory();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save tooth record."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={`🦷 Tooth ${tooth}`}>
      <div className="space-y-6">

        {onAddToTreatmentPlan && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={onAddToTreatmentPlan}
          >
            + Add to Treatment Plan
          </Button>
        )}

        <div className="border-b border-slate-200">

          <nav className="flex gap-2">

            <button
              onClick={() =>
                setActiveTab(
                  "details"
                )
              }
              className={`rounded-t-lg px-4 py-3 text-sm font-medium transition ${
                activeTab ===
                "details"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Treatment
            </button>

            <button
              onClick={() =>
                setActiveTab(
                  "history"
                )
              }
              className={`rounded-t-lg px-4 py-3 text-sm font-medium transition ${
                activeTab ===
                "history"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              History
            </button>

            <button
              onClick={() =>
                setActiveTab(
                  "attachments"
                )
              }
              className={`rounded-t-lg px-4 py-3 text-sm font-medium transition ${
                activeTab ===
                "attachments"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Attachments
            </button>

          </nav>

        </div>

        {activeTab ===
          "details" && (
          <TreatmentForm
            patientId={patientId}
            tooth={tooth}
            saving={saving}
            onSave={handleSave}
            initialValues={{
              condition:
                data?.condition ??
                "Healthy",

              diagnosis:
                data?.diagnosis ??
                "",

              treatment:
                data?.treatment ??
                "",

              treatment_status:
                data
                  ?.treatment_status ??
                "Planned",

              materials:
                data?.materials ??
                "",

              estimated_cost:
                data
                  ?.estimated_cost ??
                null,

              notes:
                data?.notes ?? "",
            }}
          />
        )}

        {activeTab ===
          "history" && (
          <ToothHistoryTab
            history={history}
          />
        )}

        {activeTab ===
          "attachments" && (
          <ToothAttachments
            patientId={patientId}
            toothNumber={tooth}
          />
        )}

      </div>
    </Card>
  );
}