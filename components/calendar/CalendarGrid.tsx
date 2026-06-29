"use client";

import CalendarDay from "./CalendarDay";
import type { CalendarDayData } from "@/types/calendar";

interface Props {
  days: CalendarDayData[];
  onSelect: (day: CalendarDayData) => void;
}

const weekDays = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export default function CalendarGrid({
  days,
  onSelect,
}: Props) {
  return (
    <div className="space-y-4">

      <div className="grid grid-cols-7 gap-3">

        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center font-semibold text-slate-500"
          >
            {day}
          </div>
        ))}

      </div>

      <div className="grid grid-cols-7 gap-3">

        {days.map((day) => (
          <CalendarDay
            key={day.date.toISOString()}
            day={day}
            onSelect={onSelect}
          />
        ))}

      </div>

    </div>
  );
}