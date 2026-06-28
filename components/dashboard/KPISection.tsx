"use client";

import {
  Users,
  CalendarDays,
  DollarSign,
  Bot,
} from "lucide-react";

const stats = [
  {
    title: "Patients",
    value: "142",
    icon: Users,
    color: "bg-blue-500",
  },
  {
    title: "Today's Appointments",
    value: "18",
    icon: CalendarDays,
    color: "bg-green-500",
  },
  {
    title: "Revenue",
    value: "KES 245K",
    icon: DollarSign,
    color: "bg-amber-500",
  },
  {
    title: "AI Conversations",
    value: "391",
    icon: Bot,
    color: "bg-purple-500",
  },
];

export default function KPISection() {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((item) => {
        const Icon = item.icon;

        return (
          <div
            key={item.title}
            className="rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-lg"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">
                  {item.title}
                </p>

                <h2 className="mt-2 text-3xl font-bold">
                  {item.value}
                </h2>
              </div>

              <div className={`${item.color} rounded-xl p-3 text-white`}>
                <Icon size={24} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}