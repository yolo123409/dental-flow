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

import { getItemTeeth, isItemInvoiced, isItemChargeCancelled } from "@/services/treatmentPlans";
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
  onViewOnChart?: (teeth: number[]) => void;
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
  const unitPrice = Number(item.estimated_price);
  const lineTotal = unitPrice * item.quantity;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  const formatted = formatCurrency(lineTotal);

  const teeth = getItemTeeth(item);
  const invoiced = isItemInvoiced(item);
  const chargeCancelled = isItemChargeCancelled(item);

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

          {/* Phase E section 10: a grouped treatment's teeth are now also
              clickable - the Dental Chart's selection now supports
              focusing several teeth at once (useToothSelection#selectMany),
              so clicking here selects every one of this Treatment's teeth
              rather than only ever the first, which used to be the
              odontogram's real limitation and no longer is. */}
          {teeth.length === 1 && (
            <button
              type="button"
              onClick={() => onViewOnChart?.(teeth)}
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-blue-100 hover:text-blue-700"
            >
              🦷 Tooth {teeth[0]}
            </button>
          )}

          {teeth.length > 1 && (
            <button
              type="button"
              onClick={() => onViewOnChart?.(teeth)}
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-blue-100 hover:text-blue-700"
            >
              🦷 Teeth {teeth.join(" · ")}
            </button>
          )}

          {teeth.length === 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-400">
              No tooth association
            </span>
          )}

          <PriorityBadge priority={item.priority} />
          <ItemStatusBadge status={item.status} />

          {/* Phase E section 8: clinical status (above) and billing state
              (here) are deliberately two separate signals, never collapsed
              into one badge - a Treatment can be clinically Completed and
              financially Not invoiced at the same time, and that isn't a
              contradiction. Only "invoiced or not" is shown - whether an
              invoiced item has actually been paid isn't data this row has
              (that lives on the invoice/payment, not the Treatment), so it
              isn't claimed here. Phase H: uses isItemInvoiced(), not raw
              charge_id - a Pending auto-created charge (every billable
              Treatment has one immediately, see createTreatment()) is NOT
              yet Billed. */}
          {invoiced ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 size={13} />
              Billed
            </span>
          ) : chargeCancelled ? (
            // Full-app audit fix C6: surfaces the new "Cancelled" charge
            // state (migration 0119) so it isn't silently invisible next
            // to "Billed"/"Not invoiced" - a cancelled treatment's charge
            // was removed from billing, not merely not-yet-billed.
            <span className="text-xs font-medium text-slate-400">
              Cancelled
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-400">
              Not invoiced
            </span>
          )}
        </div>

        {item.notes && (
          <p className="mt-1 text-sm text-slate-500">
            {item.notes}
          </p>
        )}

        {/* Phase E section 28: a quantity above 1 (almost always a
            grouped Treatment's teeth count - see createTreatment()) shows
            the per-unit breakdown rather than just the total, so "3
            teeth" and "3x price" is visible at a glance, not just the
            final number. The underlying calculation is unchanged
            (estimated_price * quantity, same as calculatePlanTotals). */}
        <p className="mt-1 text-xs text-slate-400">
          {item.quantity > 1
            ? `${formatCurrency(unitPrice)} × ${item.quantity} = ${formatted}`
            : formatted}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Edit treatment"
        >
          <Pencil size={16} />
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          aria-label="Delete treatment"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
