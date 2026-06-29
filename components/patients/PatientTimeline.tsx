"use client";

import Card from "@/components/ui/Card";
import {
  CalendarDays,
  Receipt,
  Stethoscope,
} from "lucide-react";

interface TimelineItem {
  id: string;
  title: string;
  description: string;
  date: string;
  type: "appointment" | "treatment" | "invoice";
}

interface Props {
  items: TimelineItem[];
}

export default function PatientTimeline({
  items,
}: Props) {
  return (
    <Card title="Patient Timeline">
      {items.length === 0 ? (
        <div className="py-8 text-center text-slate-500">
          No timeline history found.
        </div>
      ) : (
        <div className="relative ml-5 border-l-2 border-slate-200">

          {items.map((item) => (
            <div
              key={item.id}
              className="relative mb-8 ml-8"
            >
              <div className="absolute -left-12 top-1 rounded-full bg-blue-600 p-2 text-white">

                {item.type === "appointment" && (
                  <CalendarDays size={18} />
                )}

                {item.type === "treatment" && (
                  <Stethoscope size={18} />
                )}

                {item.type === "invoice" && (
                  <Receipt size={18} />
                )}

              </div>

              <div className="rounded-2xl border bg-white p-5 shadow-sm">

                <h3 className="font-semibold">
                  {item.title}
                </h3>

                <p className="mt-1 text-slate-500">
                  {item.description}
                </p>

                <p className="mt-3 text-sm text-blue-600">
                  {item.date}
                </p>

              </div>

            </div>
          ))}

        </div>
      )}
    </Card>
  );
}