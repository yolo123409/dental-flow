"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { searchClinicalCodes } from "@/services/clinicalCodes";
import { ClinicalCode, ClinicalCodeSystem } from "@/types/clinicalCodes";

const CODE_SYSTEM_LABELS: Record<ClinicalCodeSystem, string> = {
  "ICD-10-CM": "ICD-10-CM",
  CDT: "CDT",
  CPT: "CPT",
};

const DEBOUNCE_MS = 300;

interface Props {
  /** Required - this picker never searches across code systems. Diagnosis contexts must pass "ICD-10-CM"; procedure contexts pass "CDT" (default) or "CPT" (explicit secondary option only). */
  codeSystem: ClinicalCodeSystem;
  placeholder?: string;
  onSelect: (code: ClinicalCode) => void;
}

/**
 * Reusable searchable code picker - never loads the whole code table
 * into the browser. Debounced, server-side search via
 * services/clinicalCodes.ts#searchClinicalCodes, scoped to exactly one
 * code_system per instance (see ClinicalCodeSystem - ICD-10-CM, CDT, and
 * CPT are never mixed in one picker).
 */
export default function ClinicalCodePicker({ codeSystem, placeholder, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClinicalCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchClinicalCodes(codeSystem, query);
        if (requestIdRef.current !== thisRequestId) return;
        setResults(data);
      } finally {
        if (requestIdRef.current === thisRequestId) {
          setLoading(false);
          setSearched(true);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, codeSystem]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? `Search ${CODE_SYSTEM_LABELS[codeSystem]} codes...`}
          className="w-full rounded-xl border border-slate-300 p-3 pl-9 text-sm transition focus:border-blue-500 focus:outline-none"
        />
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          Searching {CODE_SYSTEM_LABELS[codeSystem]}...
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
          No matching {CODE_SYSTEM_LABELS[codeSystem]} codes found.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((code) => (
            <button
              key={code.id}
              type="button"
              onClick={() => {
                onSelect(code);
                setQuery("");
                setResults([]);
                setSearched(false);
              }}
              className="flex w-full flex-col items-start border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
            >
              <span className="font-mono text-sm font-semibold text-blue-700">{code.code}</span>
              <span className="text-sm text-slate-600">{code.short_description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
