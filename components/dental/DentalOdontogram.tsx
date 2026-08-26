"use client";

import Odontogram from "@/vendor/react-odontogram";
import "@/vendor/react-odontogram/styles.css";
import "./odontogram-selection.css";

import { PatientTooth } from "@/types";
import type { ToothDetail } from "@/vendor/react-odontogram";
import { Dentition } from "@/components/patients/dental/toothSelection";
import {
  PRIMARY_ODONTOGRAM_MAX_TEETH,
  primaryToothToVendorId,
  vendorFdiToPrimaryTooth,
} from "./vendorPrimaryTeeth";

interface Props {
  teeth: PatientTooth[];
  selectedTeeth: number[];

  /** Permanent renders the vendor's full 8-teeth-per-quadrant chart with
   * its own native FDI ids. Primary renders the same tooth shapes capped
   * to the first 5 per quadrant (central incisor .. second molar - a
   * primary quadrant has no premolars or third molar), with every id
   * translated to/from the real primary FDI numbers (51-85) via
   * vendorPrimaryTeeth.ts - see that file for why. */
  dentition: Dentition;

  /** Bumped by the parent whenever the selection changed from *outside*
   * the chart (a toolbar button, a chip removal) rather than from a
   * direct tooth click - see useToothSelection.ts for why the
   * uncontrolled vendor component needs this to stay in sync. */
  remountKey: number;

  /** Fires with the full current selection after every click. This is
   * the ONLY thing that should drive selection state from a click -
   * the vendor's own onToothClick fires with just the single tooth
   * that was last toggled (add *or* remove), not the resulting
   * selection, so wiring it into selection state would clobber
   * multi-select down to one tooth on every click. */
  onSelectionChange: (teeth: number[]) => void;
}

/* -------------------------------------- */
/* Condition legend (colors are canonical  */
/* across the app - do not change without  */
/* also updating the dead reference        */
/* implementation's palette).              */
/* -------------------------------------- */

const CONDITION_LEGEND: {
  key: keyof ConditionSummary;
  label: string;
  swatchClass: string;
}[] = [
  { key: "healthy", label: "Healthy", swatchClass: "border border-mineral/40 bg-white" },
  { key: "caries", label: "Caries", swatchClass: "bg-[#ef4444]" },
  { key: "filling", label: "Filling", swatchClass: "bg-[#3b82f6]" },
  { key: "crown", label: "Crown", swatchClass: "bg-[#facc15]" },
  { key: "implant", label: "Implant", swatchClass: "bg-[#8b5cf6]" },
  { key: "missing", label: "Missing", swatchClass: "bg-[#64748b]" },
];

interface ConditionSummary {
  healthy: number;
  caries: number;
  filling: number;
  crown: number;
  implant: number;
  missing: number;
}

function conditionFill(condition: PatientTooth["condition"]): {
  fillColor: string;
  outlineColor: string;
} {
  switch (condition) {
    case "Caries":
      return { fillColor: "#ef4444", outlineColor: "#b91c1c" };

    case "Filling":
      return { fillColor: "#3b82f6", outlineColor: "#1d4ed8" };

    case "Crown":
      return { fillColor: "#facc15", outlineColor: "#ca8a04" };

    case "Implant":
      return { fillColor: "#8b5cf6", outlineColor: "#6d28d9" };

    case "Missing":
      return { fillColor: "#64748b", outlineColor: "#334155" };

    default:
      return { fillColor: "#ffffff", outlineColor: "#64748b" };
  }
}

export default function DentalOdontogram({
  teeth,
  selectedTeeth,
  dentition,
  remountKey,
  onSelectionChange,
}: Props) {
  const isPrimary = dentition === "Primary";

  /** Every id the vendor renders/reports, translated to/from our logical
   * tooth number - "teeth-{number}" directly for Permanent (the vendor's
   * own scheme already matches real permanent FDI numbers), or through
   * the primary adapter for Primary. */
  const toVendorId = (toothNumber: number) =>
    isPrimary ? primaryToothToVendorId(toothNumber) : `teeth-${toothNumber}`;

  const fromVendorFdi = (vendorFdi: number) =>
    isPrimary ? vendorFdiToPrimaryTooth(vendorFdi) : vendorFdi;

  /* ------------------------------------------ */
  /* Tooth Colours                              */
  /* ------------------------------------------ */

  const toothByNumber = new Map(
    teeth.map((tooth) => [tooth.tooth_number, tooth])
  );

  const conditions = teeth.map((tooth) => {
    const { fillColor, outlineColor } = conditionFill(tooth.condition);

    return {
      label: tooth.condition,
      teeth: [toVendorId(tooth.tooth_number)],
      fillColor,
      outlineColor,
    };
  });

  /* ------------------------------------------ */
  /* Patient Summary                            */
  /* ------------------------------------------ */

  const summary: ConditionSummary = {
    healthy: 0,
    caries: 0,
    filling: 0,
    crown: 0,
    implant: 0,
    missing: 0,
  };

  teeth.forEach((tooth) => {
    switch (tooth.condition) {
      case "Caries":
        summary.caries++;
        break;

      case "Filling":
        summary.filling++;
        break;

      case "Crown":
        summary.crown++;
        break;

      case "Implant":
        summary.implant++;
        break;

      case "Missing":
        summary.missing++;
        break;

      default:
        summary.healthy++;
        break;
    }
  });

  function renderTooltip(payload?: ToothDetail) {
    if (!payload) return null;

    const toothNumber = fromVendorFdi(Number(payload.notations.fdi));
    const data = toothByNumber.get(toothNumber);
    const isSelected = selectedTeeth.includes(toothNumber);

    return (
      <div>
        <div style={{ fontWeight: 600 }}>Tooth {toothNumber}</div>
        <div>{data?.condition ?? "Healthy"}</div>
        {isSelected && <div>Selected</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* -------------------------------------- */}
      {/* Condition legend                       */}
      {/* -------------------------------------- */}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-sea-glass bg-porcelain px-5 py-3">
        {CONDITION_LEGEND.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-sm">
            <span className={`h-3 w-3 shrink-0 rounded-full ${item.swatchClass}`} aria-hidden="true" />
            <span className="text-graphite">{item.label}</span>
            <span className="data-metric font-semibold text-mineral">{summary[item.key]}</span>
          </div>
        ))}
      </div>

      {/* -------------------------------------- */}
      {/* Odontogram                             */}
      {/* -------------------------------------- */}

      <div className="rounded-2xl border border-sea-glass bg-enamel px-6 py-8">

        <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-mineral">
          Upper Arch
        </p>

        <Odontogram
          key={`${dentition}-${remountKey}`}
          theme="light"
          showLabels={false}
          maxTeeth={isPrimary ? PRIMARY_ODONTOGRAM_MAX_TEETH : 8}
          defaultSelected={selectedTeeth.map(toVendorId)}
          teethConditions={conditions}
          onChange={(details) => {
            // The vendor library calls onChange from inside its own
            // setState updater, which React treats as render-phase
            // execution - updating this component's parent
            // synchronously from there trips React's "cannot update a
            // component while rendering a different component"
            // safeguard. Deferring to a microtask moves the parent
            // update to right after the vendor's own commit finishes,
            // with no visible delay.
            const toothNumbers = details.map((detail) =>
              fromVendorFdi(Number(detail.notations.fdi))
            );
            queueMicrotask(() => onSelectionChange(toothNumbers));
          }}
          tooltip={{ content: renderTooltip }}
        />

        <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-mineral">
          Lower Arch
        </p>

      </div>

    </div>
  );
}
