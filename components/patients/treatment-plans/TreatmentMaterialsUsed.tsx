"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import usePermissions from "@/hooks/usePermissions";
import { ClinicInventoryItem, getInventoryItems } from "@/services/inventory";
import {
  addTreatmentMaterial,
  getTreatmentMaterialUsage,
  updateTreatmentMaterialQuantity,
} from "@/services/treatmentMaterialUsage";
import { TreatmentMaterialUsage } from "@/types/treatmentMaterialUsage";

interface Props {
  /** A real treatment_plan_items.id - only ever rendered when editing an
   * existing Treatment, exactly like TreatmentItemCoding in
   * TreatmentItemModal, since a usage row needs a real instance to point
   * at. */
  treatmentPlanItemId: string;
  currency: string;
}

function formatMoneyFactory(currency: string) {
  return (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
}

/**
 * One material line. Quantity is edited locally and committed (via
 * updateTreatmentMaterialQuantity, which reconciles only the delta - see
 * migration 0088) on blur/Enter, never on every keystroke - typing "10"
 * must not fire a partial commit for "1" first. Total is always
 * quantity * unit_cost, computed here and never independently editable.
 */
function MaterialUsageRow({
  row,
  currency,
  canManage,
  onCommitQuantity,
}: {
  row: TreatmentMaterialUsage;
  currency: string;
  canManage: boolean;
  onCommitQuantity: (row: TreatmentMaterialUsage, quantity: number) => void;
}) {
  const [draft, setDraft] = useState(String(row.quantity));
  const formatMoney = formatMoneyFactory(currency);

  useEffect(() => {
    setDraft(String(row.quantity));
  }, [row.quantity]);

  function commit() {
    const parsed = Number(draft);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(row.quantity));
      return;
    }

    if (parsed === row.quantity) return;

    onCommitQuantity(row, parsed);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-700">
          {row.clinic_inventory_items?.name ?? "Material"}
        </p>
        <p className="text-xs text-slate-400">
          {formatMoney(row.unit_cost)} / {row.clinic_inventory_items?.unit ?? "unit"}
        </p>
      </div>

      {canManage ? (
        <input
          type="number"
          min={0}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={`Quantity for ${row.clinic_inventory_items?.name ?? "material"}`}
          className="w-20 rounded-lg border border-slate-300 p-1.5 text-right text-sm"
        />
      ) : (
        <span className="text-slate-600">{row.quantity}</span>
      )}

      <span className="w-24 shrink-0 text-right font-semibold text-slate-700">
        {formatMoney(row.quantity * row.unit_cost)}
      </span>

      {canManage && (
        <button
          type="button"
          onClick={() => onCommitQuantity(row, 0)}
          aria-label={`Remove ${row.clinic_inventory_items?.name ?? "material"}`}
          className="shrink-0 text-slate-400 transition hover:text-red-600"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

export default function TreatmentMaterialsUsed({
  treatmentPlanItemId,
  currency,
}: Props) {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("inventory_manage");

  const [usage, setUsage] = useState<TreatmentMaterialUsage[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [items, setItems] = useState<ClinicInventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ClinicInventoryItem | null>(null);
  const [quantity, setQuantity] = useState("1");

  const formatMoney = formatMoneyFactory(currency);

  async function load() {
    try {
      const rows = await getTreatmentMaterialUsage(treatmentPlanItemId);
      setUsage(rows);
    } catch (error) {
      console.error(error);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentPlanItemId]);

  useEffect(() => {
    if (!canManage) return;

    (async () => {
      try {
        setItems(await getInventoryItems());
      } catch (error) {
        console.error(error);
      }
    })();
  }, [canManage]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || selected) return [];

    return items
      .filter((item) => item.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [query, items, selected]);

  const totalCost = usage.reduce(
    (sum, row) => sum + row.quantity * row.unit_cost,
    0
  );

  async function commitQuantity(row: TreatmentMaterialUsage, newQuantity: number) {
    // Optimistic-safe: reload from the server afterward regardless, since
    // the RPC is the one place quantity/cost/stock are actually reconciled.
    try {
      await updateTreatmentMaterialQuantity(row.id, newQuantity);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update material usage."
      );
      await load();
    }
  }

  async function handleAdd() {
    if (!selected) {
      toast.error("Search for and select a material first.");
      return;
    }

    const parsedQuantity = Number(quantity);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Enter a quantity greater than 0.");
      return;
    }

    try {
      await addTreatmentMaterial(
        treatmentPlanItemId,
        selected.id,
        parsedQuantity
      );

      await load();

      setSelected(null);
      setQuery("");
      setQuantity("1");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to record material usage."
      );
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <label className="block font-medium">Materials Used</label>

      {usage.length > 0 && (
        <div className="space-y-2">
          {usage.map((row) => (
            <MaterialUsageRow
              key={row.id}
              row={row}
              currency={currency}
              canManage={canManage}
              onCommitQuantity={commitQuantity}
            />
          ))}
        </div>
      )}

      {usage.length === 0 && (
        <p className="text-xs text-slate-400">
          No materials recorded for this treatment yet.
        </p>
      )}

      {canManage && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                placeholder="+ Add Inventory Item"
                className="w-full rounded-xl border border-slate-300 p-2.5 text-sm"
              />

              {filtered.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelected(item);
                        setQuery(item.name);
                      }}
                      className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50"
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatMoney(item.cost_per_unit)}/{item.unit} ·{" "}
                        {item.quantity} in stock
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-label="Quantity to add"
              className="w-20 rounded-xl border border-slate-300 p-2.5 text-sm"
            />

            <button
              type="button"
              onClick={handleAdd}
              disabled={!selected}
              className="shrink-0 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {selected && (
            <p className="text-xs text-slate-400">
              {selected.name}: {formatMoney(selected.cost_per_unit)} per{" "}
              {selected.unit} - total{" "}
              {formatMoney(
                selected.cost_per_unit * (Number(quantity) || 0)
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold text-slate-700">
        <span>Total Material Cost</span>
        <span>{formatMoney(totalCost)}</span>
      </div>
    </div>
  );
}
