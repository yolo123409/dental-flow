import FeatureRow from "@/components/marketing/FeatureRow";

const treatments = [
  { label: "Cleanings", value: 82 },
  { label: "Fillings", value: 61 },
  { label: "Root canals", value: 34 },
  { label: "Whitening", value: 22 },
];

const trendPoints =
  "0,52 30,44 60,48 90,30 120,34 150,18 180,22 210,8 240,14";

function AnalyticsVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
        Revenue, last 9 weeks
      </p>

      <svg viewBox="0 0 240 60" className="mt-3 h-16 w-full" aria-hidden="true">
        <polyline
          points={trendPoints}
          fill="none"
          stroke="var(--eucalyptus)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={`0,60 ${trendPoints} 240,60`}
          fill="var(--sea-glass)"
          stroke="none"
          opacity="0.5"
        />
      </svg>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-mineral">
        Treatment mix, this quarter
      </p>

      <div className="mt-3 space-y-2.5">
        {treatments.map((treatment) => (
          <div key={treatment.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs font-medium text-mineral">
              {treatment.label}
            </span>
            <div className="h-2 flex-1 rounded-full bg-porcelain">
              <div
                className="h-2 rounded-full bg-eucalyptus"
                style={{ width: `${treatment.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsShowcase() {
  return (
    <FeatureRow
      id="analytics"
      eyebrow="Analytics & Reporting"
      title="See the whole practice, clearly."
      description="Revenue, treatment mix, and branch performance in one view - so decisions are made from what's actually happening in the practice, not a gut feeling."
      reverse
      visual={<AnalyticsVisual />}
    />
  );
}
