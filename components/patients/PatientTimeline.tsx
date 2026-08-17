"use client";

import { useState } from "react";

import Card from "@/components/ui/Card";

import {
  CalendarDays,
  MessageCircle,
  Receipt,
  Stethoscope,
} from "lucide-react";

import { TimelineCodeBadge, TimelineItem } from "@/types";

interface Props {
  items: TimelineItem[];
}

function CodeBadge({ badge }: { badge: TimelineCodeBadge }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-600 transition hover:bg-slate-200"
      >
        {badge.codeSystem}: {badge.code}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
          <p className="font-mono font-semibold text-slate-700">{badge.code}</p>
          <p className="mt-1 text-slate-600">{badge.shortDescription}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{badge.codeSystem}</p>
        </div>
      )}
    </span>
  );
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

              <div
                className={`absolute -left-12 top-1 rounded-full p-2 text-white ${
                  item.type === "reminder"
                    ? "bg-green-600"
                    : "bg-blue-600"
                }`}
              >

                {item.type === "appointment" && (
                  <CalendarDays size={18} />
                )}

                {item.type === "treatment" && (
                  <Stethoscope size={18} />
                )}

                {item.type === "invoice" && (
                  <Receipt size={18} />
                )}

                {item.type === "reminder" && (
                  <MessageCircle size={18} />
                )}

              </div>

              <div className="rounded-2xl border bg-white p-5 shadow-sm">

                <h3 className="font-semibold">
                  {item.title}
                </h3>

                <p className="mt-1 text-slate-500">
                  {item.description}
                </p>

                {((item.diagnosisCodes?.length ?? 0) > 0 || (item.procedureCodes?.length ?? 0) > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.diagnosisCodes?.map((badge) => (
                      <CodeBadge key={`${badge.codeSystem}-${badge.code}`} badge={badge} />
                    ))}
                    {item.procedureCodes?.map((badge) => (
                      <CodeBadge key={`${badge.codeSystem}-${badge.code}`} badge={badge} />
                    ))}
                  </div>
                )}

                <p className="mt-3 text-sm text-blue-600">
                  {new Date(
                    item.created_at
                  ).toLocaleString()}
                </p>

              </div>

            </div>

          ))}

        </div>

      )}

    </Card>
  );
}
