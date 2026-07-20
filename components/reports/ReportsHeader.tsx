"use client";

const ranges = [
  "Today",
  "7 Days",
  "30 Days",
  "This Year",
  "All Time",
];

interface ReportsHeaderProps {
  selectedRange: string;
  onRangeChange: (range: string) => void;
}

export default function ReportsHeader({
  selectedRange,
  onRangeChange,
}: ReportsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-3xl font-bold">
          Reports & Analytics
        </h1>

        <p className="mt-2 text-slate-500">
          Monitor your clinic&apos;s performance.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ranges.map((range) => (
          <button
            key={range}
            onClick={() => onRangeChange(range)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              selectedRange === range
                ? "bg-blue-600 text-white"
                : "border border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}