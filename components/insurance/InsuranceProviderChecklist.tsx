"use client";

import { useMemo, useState } from "react";

import SearchInput from "@/components/ui/SearchInput";

import { InsuranceProvider } from "@/types/insurance";

interface Props {
  providers: InsuranceProvider[];
  selectedIds: string[];
  onToggle: (providerId: string) => void;
  emptyMessage?: string;
}

/**
 * The one searchable multi-select insurer checklist, reused as-is
 * (inline) by onboarding and Settings, and inside a Modal by the
 * invoice screen's quick-add flow - purely presentational/controlled,
 * no data fetching of its own.
 */
export default function InsuranceProviderChecklist({
  providers,
  selectedIds,
  onToggle,
  emptyMessage = "No insurance providers found.",
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return providers;

    return providers.filter((provider) =>
      provider.name.toLowerCase().includes(query)
    );
  }, [providers, search]);

  return (
    <div className="space-y-3">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search insurance providers..."
      />

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-sea-glass p-3">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-mineral">
            {emptyMessage}
          </p>
        ) : (
          filtered.map((provider) => (
            <label
              key={provider.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-graphite hover:bg-porcelain"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(provider.id)}
                onChange={() => onToggle(provider.id)}
                className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
              />
              {provider.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
