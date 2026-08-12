"use client";

import { useMemo, useState } from "react";

import { OrganizationBranch } from "@/services/organizations";

interface Props {
  branches: OrganizationBranch[];
  selectedBranchIds: string[];
  onChange: (ids: string[]) => void;
  searchable?: boolean;
  showSelectAll?: boolean;
}

/**
 * Extracted from the identical checkbox block that used to be duplicated
 * in InviteOrganizationMemberModal.tsx and EditOrganizationMemberModal.tsx.
 * Adds search + Select All/Clear All, which the original inline picker had
 * neither of - needed once an organization has dozens of branches (up to
 * 52 per the Phase 7 spec), not just a handful. Flat/alphabetical - no
 * region grouping, since no `region` concept exists anywhere in this
 * schema.
 */
export default function BranchMultiSelect({
  branches,
  selectedBranchIds,
  onChange,
  searchable = true,
  showSelectAll = true,
}: Props) {
  const [query, setQuery] = useState("");

  const visibleBranches = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return branches;

    return branches.filter((branch) =>
      branch.name.toLowerCase().includes(q)
    );
  }, [branches, query]);

  function toggleBranch(clinicId: string) {
    onChange(
      selectedBranchIds.includes(clinicId)
        ? selectedBranchIds.filter((id) => id !== clinicId)
        : [...selectedBranchIds, clinicId]
    );
  }

  function selectAll() {
    onChange(visibleBranches.map((branch) => branch.id));
  }

  function clearAll() {
    onChange([]);
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-lg border border-sea-glass p-3">
        <p className="text-sm text-mineral">No branches yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(searchable || showSelectAll) && (
        <div className="flex items-center gap-2">
          {searchable && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches..."
              className="min-h-9 flex-1 rounded-lg border border-sea-glass bg-enamel px-3 py-1.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            />
          )}

          {showSelectAll && (
            <div className="flex shrink-0 gap-2 text-xs font-semibold text-eucalyptus">
              <button type="button" onClick={selectAll} className="hover:underline">
                Select All
              </button>
              <span className="text-mineral">/</span>
              <button type="button" onClick={clearAll} className="hover:underline">
                Clear All
              </button>
            </div>
          )}
        </div>
      )}

      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-sea-glass p-3">
        {visibleBranches.length === 0 ? (
          <p className="text-sm text-mineral">No branches match your search.</p>
        ) : (
          visibleBranches.map((branch) => (
            <label
              key={branch.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-graphite hover:bg-porcelain"
            >
              <input
                type="checkbox"
                checked={selectedBranchIds.includes(branch.id)}
                onChange={() => toggleBranch(branch.id)}
                className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
              />
              {branch.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
