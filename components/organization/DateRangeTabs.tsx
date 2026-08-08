"use client";

const RANGES = [
  "Today",
  "This Month",
  "7 Days",
  "30 Days",
  "This Year",
  "All Time",
];

interface Props {
  value: string;
  onChange: (range: string) => void;
}

export default function DateRangeTabs({
  value,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            range === value
              ? "border-eucalyptus bg-eucalyptus text-enamel"
              : "border-sea-glass bg-porcelain text-graphite hover:border-mineral/50"
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
