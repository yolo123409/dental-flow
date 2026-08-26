"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";

import ToothDetails from "./ToothDetails";
import SelectionToolbar from "./SelectionToolbar";
import BulkTreatmentModal from "./BulkTreatmentModal";
import { useToothSelection } from "./useToothSelection";
import DentalOdontogram from "@/components/dental/DentalOdontogram";

import { getPatientTeeth } from "@/services/patientTeeth";

import { PatientTooth } from "@/types";
import {
  Dentition,
  isValidPrimaryTooth,
  isValidTooth,
} from "./toothSelection";

interface Props {
  patientId: string;

  /** Used only by the Phase C multi-tooth "Add Treatment" action, which
   * formats a live cost total - matches the currency already shown
   * elsewhere on this patient's Billing/Treatment Plans tabs. */
  currency: string;

  /** Externally-requested tooth/teeth to focus (e.g. from the Treatment
   * Plans tab - a single-tooth Treatment sends one, a grouped Treatment
   * sends all of its teeth so the odontogram shows the same relationship
   * the Treatment Plan does, per Phase E section 10). Purely additive -
   * internal click-to-select behavior is unchanged when this is omitted.
   * Treatment Plan items only ever reference permanent teeth, so a focus
   * request always switches the chart back to Permanent. */
  focusTeeth?: number[] | null;

  /** Called with the currently selected tooth when the user wants to
   * add it to a treatment plan. Only offered for a single-tooth
   * selection, since a treatment plan entry targets one tooth. */
  onAddToTreatmentPlan?: (tooth: number) => void;
}

function DentitionToggle({
  value,
  onChange,
}: {
  value: Dentition;
  onChange: (dentition: Dentition) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Dentition"
      className="inline-flex items-center gap-1 rounded-lg border border-sea-glass bg-porcelain p-1"
    >
      {(["Permanent", "Primary"] as const).map((option) => {
        const isActive = value === option;

        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive
                ? "bg-eucalyptus text-white"
                : "text-mineral hover:bg-sea-glass/60 hover:text-graphite"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export default function DentalChart({
  patientId,
  currency,
  focusTeeth,
  onAddToTreatmentPlan,
}: Props) {
  const [dentition, setDentition] = useState<Dentition>("Permanent");

  const selection = useToothSelection([], dentition);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  function handleDentitionChange(next: Dentition) {
    setDentition(next);
    // Permanent and primary tooth numbers never overlap (11-48 vs
    // 51-85), so any existing selection is always invalid for the
    // dentition being switched to - clear it rather than leave a
    // selection referencing teeth that aren't even rendered anymore.
    selection.clear();
  }

  useEffect(() => {
    if (focusTeeth != null && focusTeeth.length > 0) {
      setDentition("Permanent");
      selection.selectMany(focusTeeth);
    }
    // Only re-run when focusTeeth's contents change - selection's
    // identity changes on every render (it's a fresh hook result), and
    // the caller may pass a new array instance with the same teeth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTeeth?.join(",")]);

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

  // The odontogram (and its condition legend/counts) only ever shows the
  // currently-selected dentition's teeth - a permanent tooth record has
  // no rendered tooth to color while viewing Primary, and vice versa.
  const dentitionTeeth = useMemo(
    () =>
      teeth.filter((tooth) =>
        dentition === "Primary"
          ? isValidPrimaryTooth(tooth.tooth_number)
          : isValidTooth(tooth.tooth_number)
      ),
    [teeth, dentition]
  );

  const selectedCount = selection.selectedList.length;
  const singleSelectedTooth =
    selectedCount === 1 ? selection.selectedList[0] : null;

  const singleSelectedToothData =
    singleSelectedTooth != null
      ? toothMap[singleSelectedTooth] ?? null
      : null;

  return (
    <Card>
      <div className="space-y-8">

        {/* -------------------------------------- */}
        {/* Header                                 */}
        {/* -------------------------------------- */}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-graphite">
              Dental Chart
            </h2>
            <p className="mt-1 text-sm text-mineral">
              Full-mouth clinical overview - select a tooth to view or edit its condition,
              diagnosis, treatment, and history.
            </p>
          </div>

          <DentitionToggle value={dentition} onChange={handleDentitionChange} />
        </div>

        {loading ? (

          <div className="flex h-80 items-center justify-center">

            <p className="text-mineral">
              Loading dental chart...
            </p>

          </div>

        ) : (

          <div className="grid gap-8 lg:grid-cols-3">

            {/* Left */}

            <div className="space-y-4 lg:col-span-2">

              <SelectionToolbar
                selected={selection.selectedList}
                onRemoveTooth={selection.removeTooth}
                onClear={selection.clear}
                onSelectAll={selection.selectAll}
                onSelectArch={selection.selectArch}
                onSelectQuadrant={selection.selectQuadrant}
                onAddTreatment={() => setBulkModalOpen(true)}
              />

              <DentalOdontogram
                teeth={dentitionTeeth}
                selectedTeeth={selection.selectedList}
                dentition={dentition}
                remountKey={selection.remountKey}
                onSelectionChange={selection.syncFromOdontogram}
              />

            </div>

            {/* Right */}

            <div>

              {selectedCount === 0 && (

                <div className="flex min-h-125 items-center">
                  <EmptyState
                    title="No tooth selected"
                    description="Click any tooth to view or edit its condition, diagnosis, treatment, and clinical notes. Use the quick-select controls to work with a quadrant, an arch, or the whole chart at once."
                  />
                </div>

              )}

              {selectedCount === 1 && singleSelectedTooth != null && (

                <ToothDetails
                  patientId={patientId}
                  tooth={singleSelectedTooth}
                  data={singleSelectedToothData}
                  currency={currency}
                  onSaved={loadTeeth}
                  onAddToTreatmentPlan={
                    onAddToTreatmentPlan
                      ? () =>
                          onAddToTreatmentPlan(
                            singleSelectedTooth
                          )
                      : undefined
                  }
                />

              )}

              {selectedCount > 1 && (

                <div className="rounded-2xl border border-sea-glass bg-enamel p-6">

                  <h3 className="font-display text-xl font-bold text-graphite">
                    {selectedCount} Teeth Selected
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-mineral">
                    Individual tooth history and
                    attachments are only shown for a
                    single tooth - select just one to
                    view them. From here you can add one
                    treatment covering every selected
                    tooth at once.
                  </p>

                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {selection.selectedList.map((tooth) => (
                      <span
                        key={tooth}
                        className="data-metric rounded-full bg-sea-glass px-2.5 py-1 text-xs font-semibold text-deep-eucalyptus"
                      >
                        {tooth}
                      </span>
                    ))}
                  </div>

                  <Button
                    variant="primary"
                    className="mt-6 w-full"
                    onClick={() => setBulkModalOpen(true)}
                  >
                    Add Treatment to {selectedCount} Teeth
                  </Button>

                </div>

              )}

            </div>

          </div>

        )}

      </div>

      <BulkTreatmentModal
        open={bulkModalOpen}
        patientId={patientId}
        currency={currency}
        teeth={selection.selectedList}
        onClose={() => setBulkModalOpen(false)}
        onSaved={loadTeeth}
      />

    </Card>
  );
}
