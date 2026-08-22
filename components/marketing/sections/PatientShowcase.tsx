import { Phone, FileText, CalendarCheck, Activity } from "lucide-react";

import FeatureRow from "@/components/marketing/FeatureRow";

const timeline = [
  { label: "Cleaning & checkup", meta: "Westlands - 3 weeks ago", icon: CalendarCheck },
  { label: "X-ray uploaded", meta: "Westlands - 3 weeks ago", icon: FileText },
  { label: "Root canal, tooth 26", meta: "Westlands - 2 months ago", icon: Activity },
];

function PatientVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sea-glass font-display text-lg font-bold text-eucalyptus">
          AN
        </div>
        <div>
          <p className="font-semibold text-graphite">Amara N. (Demo Patient)</p>
          <p className="text-sm text-mineral">Patient since 2023 - Westlands</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-porcelain px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Phone
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-medium text-graphite">
            <Phone size={13} className="text-eucalyptus" />
            +254 700 000 000
          </p>
        </div>
        <div className="rounded-lg bg-porcelain px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Insurance
          </p>
          <p className="mt-0.5 font-medium text-graphite">Demo Insurance</p>
        </div>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-mineral">
        Recent activity
      </p>

      <div className="mt-2.5 space-y-2">
        {timeline.map((entry) => {
          const Icon = entry.icon;
          return (
            <div
              key={entry.label}
              className="flex items-center gap-3 rounded-lg border border-sea-glass px-3 py-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sea-glass text-eucalyptus">
                <Icon size={14} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-graphite">
                  {entry.label}
                </p>
                <p className="text-xs text-mineral">{entry.meta}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PatientShowcase() {
  return (
    <FeatureRow
      id="patients"
      eyebrow="Patient Management"
      title="Everything about the patient. In one place."
      description="Contact details, insurance, treatment history, and clinical notes stay together on one record, so any staff member can pick up the full picture instantly - at any branch."
      visual={<PatientVisual />}
    />
  );
}
