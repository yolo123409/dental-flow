"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

import Button from "@/components/ui/Button";

import { Arch, Quadrant, describeSelection } from "./toothSelection";

const QUICK_SELECT: Array<
  { label: string; onSelect: (helpers: QuickSelectHelpers) => void }
> = [
  { label: "Select All", onSelect: (h) => h.selectAll() },
  { label: "Upper Arch", onSelect: (h) => h.selectArch("upper") },
  { label: "Lower Arch", onSelect: (h) => h.selectArch("lower") },
  { label: "UR", onSelect: (h) => h.selectQuadrant("UR") },
  { label: "UL", onSelect: (h) => h.selectQuadrant("UL") },
  { label: "LL", onSelect: (h) => h.selectQuadrant("LL") },
  { label: "LR", onSelect: (h) => h.selectQuadrant("LR") },
];

interface QuickSelectHelpers {
  selectAll: () => void;
  selectArch: (arch: Arch) => void;
  selectQuadrant: (quadrant: Quadrant) => void;
}

const MAX_VISIBLE_CHIPS = 10;

interface Props {
  selected: number[];
  onRemoveTooth: (tooth: number) => void;
  onClear: () => void;
  onSelectAll: () => void;
  onSelectArch: (arch: Arch) => void;
  onSelectQuadrant: (quadrant: Quadrant) => void;
  onAddTreatment: () => void;
}

export default function SelectionToolbar({
  selected,
  onRemoveTooth,
  onClear,
  onSelectAll,
  onSelectArch,
  onSelectQuadrant,
  onAddTreatment,
}: Props) {
  const reduceMotion = useReducedMotion();
  const helpers: QuickSelectHelpers = {
    selectAll: onSelectAll,
    selectArch: onSelectArch,
    selectQuadrant: onSelectQuadrant,
  };

  const count = selected.length;
  const showChips = count > 0 && count <= MAX_VISIBLE_CHIPS;

  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={describeSelection(new Set(selected))}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              className="text-sm font-semibold text-graphite"
            >
              {describeSelection(new Set(selected))}
            </motion.p>
          </AnimatePresence>

          {showChips && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {selected.map((tooth) => (
                  <motion.button
                    key={tooth}
                    type="button"
                    onClick={() => onRemoveTooth(tooth)}
                    initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                    transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    className="inline-flex items-center gap-1 rounded-full bg-sea-glass px-2.5 py-1 text-xs font-semibold text-deep-eucalyptus transition-colors hover:bg-clay/20 hover:text-clay-ink"
                    aria-label={`Remove tooth ${tooth} from selection`}
                  >
                    {tooth}
                    <X size={11} />
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {count > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="primary" onClick={onAddTreatment}>
              Add Treatment
            </Button>

            <Button variant="quiet" onClick={onClear}>
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-sea-glass pt-3">
        {QUICK_SELECT.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => action.onSelect(helpers)}
            className="rounded-lg border border-sea-glass bg-porcelain px-3 py-1.5 text-xs font-semibold text-graphite transition-colors hover:border-eucalyptus/50 hover:bg-sea-glass/60"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
