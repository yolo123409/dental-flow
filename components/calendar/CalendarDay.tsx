"use client";

import type { CalendarDayData } from "@/types/calendar";

interface Props {
  day: CalendarDayData;
  onSelect: (day: CalendarDayData) => void;
}

export default function CalendarDay({
  day,
  onSelect,
}: Props) {
  return (
    <button
      onClick={() => onSelect(day)}
      className={`min-h-35 rounded-xl border p-3 text-left transition-all hover:border-blue-500 hover:shadow-md ${
        day.isToday
          ? "border-blue-500 bg-blue-50"
          : day.isCurrentMonth
          ? "bg-white"
          : "bg-slate-50 text-slate-400"
      }`}
    >
      <div className="flex items-center justify-between">

        <span
          className={`font-semibold ${
            day.isToday
              ? "text-blue-600"
              : ""
          }`}
        >
          {day.date.getDate()}
        </span>

        {day.appointments.length > 0 && (
          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
            {day.appointments.length}
          </span>
        )}

      </div>

      <div className="mt-3 space-y-2">

        {day.appointments
          .slice(0, 3)
          .map((appointment) => (
            <div
              key={appointment.id}
              className="truncate rounded-lg bg-blue-500 px-2 py-1 text-xs text-white"
            >
              {appointment.appointment_time.slice(0, 5)}
              {" • "}
              {appointment.treatment}
            </div>
          ))}

        {day.appointments.length > 3 && (
          <p className="text-xs text-slate-500">
            +{day.appointments.length - 3} more
          </p>
        )}

      </div>

    </button>
  );
}