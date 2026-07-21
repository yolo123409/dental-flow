"use client";

import Button from "@/components/ui/Button";

interface Props {
  currentDate: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export default function CalendarHeader({
  currentDate,
  onPrevious,
  onNext,
  onToday,
}: Props) {
  const month = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">

      <div>

        <h1 className="text-4xl font-bold">
          Calendar
        </h1>

        <p className="mt-2 text-slate-500">
          Manage appointments across your clinic.
        </p>

      </div>

      <div className="flex flex-wrap items-center gap-3">

        <Button
          variant="secondary"
          onClick={onPrevious}
        >
          ← Previous
        </Button>

        <div className="min-w-55 text-center">

          <h2 className="text-2xl font-bold">
            {month}
          </h2>

        </div>

        <Button
          variant="secondary"
          onClick={onNext}
        >
          Next →
        </Button>

        <Button
          onClick={onToday}
        >
          Today
        </Button>

      </div>

    </div>
  );
}