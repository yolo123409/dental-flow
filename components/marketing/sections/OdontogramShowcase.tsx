"use client";

import { useState } from "react";

import Reveal from "@/components/marketing/Reveal";

interface Tooth {
  fdi: string;
  condition: "healthy" | "treated" | "attention";
}

const upperRight: Tooth[] = ["18", "17", "16", "15", "14", "13", "12", "11"].map(
  (fdi) => ({ fdi, condition: "healthy" })
);
const upperLeft: Tooth[] = ["21", "22", "23", "24", "25", "26", "27", "28"].map(
  (fdi) => ({ fdi, condition: fdi === "26" ? "treated" : "healthy" })
);
const lowerRight: Tooth[] = ["48", "47", "46", "45", "44", "43", "42", "41"].map(
  (fdi) => ({ fdi, condition: fdi === "46" ? "attention" : "healthy" })
);
const lowerLeft: Tooth[] = ["31", "32", "33", "34", "35", "36", "37", "38"].map(
  (fdi) => ({ fdi, condition: "healthy" })
);

const details: Record<
  string,
  { type: string; condition: string; note: string; attachments: number }
> = {
  "26": {
    type: "Upper left first molar",
    condition: "Root canal - completed",
    note: "Treated 2 months ago. Crown placed, no sensitivity reported.",
    attachments: 3,
  },
  "46": {
    type: "Lower right first molar",
    condition: "Flagged for review",
    note: "Mild sensitivity reported at last cleaning - scheduled for evaluation.",
    attachments: 1,
  },
};

function conditionDotClass(condition: Tooth["condition"]) {
  if (condition === "treated") return "bg-eucalyptus";
  if (condition === "attention") return "bg-clay";
  return "bg-sea-glass";
}

function archOffset(index: number, total: number) {
  const center = (total - 1) / 2;
  const distance = Math.abs(index - center);
  return Math.round(distance * distance * 0.3);
}

function ToothRow({
  teeth,
  selected,
  onSelect,
  curveDown,
}: {
  teeth: Tooth[];
  selected: string;
  onSelect: (fdi: string) => void;
  curveDown: boolean;
}) {
  return (
    <div className="flex gap-1 sm:gap-1.5 lg:gap-2">
      {teeth.map((tooth, index) => {
        const isSelected = tooth.fdi === selected;
        const offset = archOffset(index, teeth.length);

        return (
          <button
            key={tooth.fdi}
            type="button"
            onClick={() => onSelect(tooth.fdi)}
            style={{
              transform: `translateY(${curveDown ? offset : -offset}px)`,
            }}
            className={`group relative flex h-11 w-7 flex-col items-center justify-end rounded-t-md rounded-b-lg border pb-1.5 transition-all sm:h-12 sm:w-8 ${
              isSelected
                ? "border-eucalyptus bg-eucalyptus shadow-[0_8px_20px_-8px_rgba(23,85,82,0.6)]"
                : "border-sea-glass bg-porcelain hover:border-eucalyptus/60 hover:bg-sea-glass/60"
            }`}
            aria-pressed={isSelected}
            aria-label={`Tooth ${tooth.fdi}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isSelected ? "bg-white" : conditionDotClass(tooth.condition)
              }`}
            />
            <span
              className={`data-metric mt-1 text-[10px] font-semibold ${
                isSelected ? "text-white" : "text-mineral"
              }`}
            >
              {tooth.fdi}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function OdontogramShowcase() {
  const [selected, setSelected] = useState("26");
  const detail = details[selected] ?? {
    type: "Healthy tooth",
    condition: "No treatment on record",
    note: "No clinical notes for this tooth yet.",
    attachments: 0,
  };

  return (
    <section id="odontogram" className="border-y border-sea-glass bg-enamel py-20 sm:py-28">
      <Reveal className="mx-auto max-w-2xl px-6 text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-eucalyptus">
          Interactive Odontogram
        </span>
        <h3 className="mt-3 font-display text-3xl font-bold text-graphite text-balance sm:text-4xl">
          Built for dentistry. Down to the tooth.
        </h3>
        <p className="mt-4 text-base leading-7 text-mineral text-pretty">
          A full tooth-by-tooth chart for every patient - select a tooth to
          see its condition and treatment history, kept accurate visit
          after visit.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mx-auto mt-12 max-w-5xl px-6">
        <div className="grid gap-6 rounded-2xl border border-sea-glass bg-porcelain/60 p-6 sm:p-8 lg:grid-cols-[1fr_230px] lg:items-center lg:gap-8">
          <div className="mkt-scroll-x">
            <div className="mx-auto flex w-max flex-col items-center gap-3 py-2">
              <ToothRow
                teeth={[...upperRight, ...upperLeft]}
                selected={selected}
                onSelect={setSelected}
                curveDown={false}
              />
              <div className="h-px w-full bg-sea-glass" />
              <ToothRow
                teeth={[...lowerRight, ...lowerLeft]}
                selected={selected}
                onSelect={setSelected}
                curveDown
              />
            </div>

            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-mineral">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sea-glass" /> Healthy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-eucalyptus" /> Treated
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Needs review
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-sea-glass bg-enamel p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Tooth {selected}
            </p>
            <p className="mt-1 font-display text-lg font-semibold text-graphite">
              {detail.type}
            </p>
            <p className="mt-2 text-sm font-medium text-eucalyptus">
              {detail.condition}
            </p>
            <p className="mt-3 text-sm leading-6 text-mineral">
              {detail.note}
            </p>
            <div className="mt-4 border-t border-sea-glass pt-3 text-xs text-mineral">
              {detail.attachments} attachment{detail.attachments === 1 ? "" : "s"} on file
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
