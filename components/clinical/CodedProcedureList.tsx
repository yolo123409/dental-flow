"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { AttachedProcedureCode } from "@/types/clinicalCodes";

interface Props {
  codes: AttachedProcedureCode[];
  onRemove?: (key: string) => void;
  onAddModifier?: (procedureKey: string, modifierCode: string, modifierDescription: string | null) => void;
  onRemoveModifier?: (procedureKey: string, modifierKey: string) => void;
  /** Hides remove/add-modifier controls - used for read-only surfaces like Tooth History, where showing interactive controls that do nothing would be misleading. */
  readOnly?: boolean;
}

function ModifierRow({
  procedureKey,
  onAddModifier,
}: {
  procedureKey: string;
  onAddModifier: NonNullable<Props["onAddModifier"]>;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
      >
        <Plus size={12} /> Add modifier
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Modifier code"
        className="w-28 rounded-lg border border-slate-300 p-2 text-xs"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="min-w-40 flex-1 rounded-lg border border-slate-300 p-2 text-xs"
      />
      <button
        type="button"
        disabled={!code.trim()}
        onClick={() => {
          onAddModifier(procedureKey, code.trim(), description.trim() || null);
          setCode("");
          setDescription("");
          setAdding(false);
        }}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setCode("");
          setDescription("");
          setAdding(false);
        }}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Compact chip list for attached CDT/CPT procedure codes, each with an
 * optional inline modifiers sub-list. Used wherever a procedure is
 * entered (Tooth Details / TreatmentForm / Treatment Plan items).
 * Modifiers attach to this specific procedure-code instance, never to
 * the master clinical_codes row.
 */
export default function CodedProcedureList({
  codes,
  onRemove,
  onAddModifier,
  onRemoveModifier,
  readOnly = false,
}: Props) {
  if (codes.length === 0) return null;

  return (
    <div className="space-y-3">
      {codes.map((item) => (
        <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.code.code_system}
              </span>
              <div>
                <span className="font-mono text-sm font-semibold text-blue-700">{item.code.code}</span>
                <span className="ml-2 text-sm text-slate-600">{item.code.short_description}</span>
              </div>
            </div>

            {!readOnly && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.key)}
                className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                aria-label={`Remove ${item.code.code}`}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {item.modifiers.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
              {item.modifiers.map((modifier) => (
                <div key={modifier.key} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    <span className="font-mono font-semibold text-slate-700">{modifier.modifierCode}</span>
                    {modifier.modifierDescription && (
                      <span className="ml-2 text-slate-500">{modifier.modifierDescription}</span>
                    )}
                  </span>
                  {!readOnly && onRemoveModifier && (
                    <button
                      type="button"
                      onClick={() => onRemoveModifier(item.key, modifier.key)}
                      className="text-slate-400 hover:text-slate-600"
                      aria-label={`Remove modifier ${modifier.modifierCode}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!readOnly && onAddModifier && (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <ModifierRow procedureKey={item.key} onAddModifier={onAddModifier} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
