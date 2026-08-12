"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { switchActiveBranch } from "@/services/organizations";
import {
  searchOrganizationPatients,
  OrganizationPatientSearchResult,
} from "@/services/organizationSearch";
import { logError } from "@/lib/logError";

const DEBOUNCE_MS = 300;

export default function OrganizationSearch() {
  const { organizationUser } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrganizationPatientSearchResult[]>(
    []
  );
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!organizationUser || !query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);

        const data = await searchOrganizationPatients(
          organizationUser.organization_id,
          query
        );

        setResults(data);
        setOpen(true);
      } catch (error) {
        logError("[OrganizationSearch] search failed:", error);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, organizationUser]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSelect(result: OrganizationPatientSearchResult) {
    if (switchingId) return;

    try {
      setSwitchingId(result.patient_id);

      // Reuses the same branch-switch flow the Branch Performance table
      // and BranchSwitcher already use - never a separate mechanism.
      await switchActiveBranch(result.clinic_id);

      window.location.href = `/admin/patients/${result.patient_id}`;
    } catch (error) {
      logError("[OrganizationSearch] switchActiveBranch failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to open this patient's branch."
      );

      setSwitchingId(null);
    }
  }

  if (!organizationUser) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-mineral"
        />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setOpen(true)}
          placeholder="Search patients across branches..."
          className="w-full rounded-lg border border-sea-glass bg-enamel py-2.5 pl-9 pr-3 text-sm text-graphite placeholder:text-mineral focus:border-eucalyptus focus:outline-none"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-12 z-40 w-full rounded-lg border border-sea-glass bg-enamel shadow-xl">
          {searching ? (
            <p className="px-4 py-3 text-sm text-mineral">Searching...</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-mineral">
              No patients found.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-2">
              {results.map((result) => (
                <button
                  key={result.patient_id}
                  type="button"
                  disabled={switchingId !== null}
                  onClick={() => handleSelect(result)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-porcelain disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium text-graphite">
                    {result.first_name} {result.last_name}
                  </span>
                  <span className="text-xs text-mineral">
                    {result.clinic_name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
