"use client";

import {
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  CheckCircle2,
} from "lucide-react";

import {
  PriorityBadge,
  ItemStatusBadge,
} from "./TreatmentPlanBadges";

import { TreatmentPlanItem } from "@/types/treatmentPlan";

interface Props {
  item: TreatmentPlanItem;
  currency: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onViewOnChart?: (tooth: number) => void;
}

export default function TreatmentItemRow({
  item,
  currency,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onViewOnChart,
}: Props) {
  const lineTotal =
    Number(item.estimated_price) * item.quantity;

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(lineTotal);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-1 pt-1">
        <button
          type="button"
          disabled={isFirst}
          onClick={onMoveUp}
          className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Move up"
        >
          <ChevronUp size={16} />
        </button>

        <button
          type="button"
          disabled={isLast}
          onClick={onMoveDown}
          className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Move down"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">
            {item.procedure}
          </p>

          {item.tooth_number != null && (
            <button
              type="button"
              onClick={() =>
                onViewOnChart?.(item.tooth_number!)
              }
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-blue-100 hover:text-blue-700"
            >
              🦷 Tooth {item.tooth_number}
            </button>
          )}

          <PriorityBadge priority={item.priority} />
          <ItemStatusBadge status={item.status} />

          {item.charge_id && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 size={13} />
              Billed
            </span>
          )}
        </div>

        {item.notes && (
          <p className="mt-1 text-sm text-slate-500">
            {item.notes}
          </p>
        )}

        <p className="mt-1 text-xs text-slate-400">
          Qty {item.quantity} · {formatted}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Edit procedure"
        >
          <Pencil size={16} />
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          aria-label="Delete procedure"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
