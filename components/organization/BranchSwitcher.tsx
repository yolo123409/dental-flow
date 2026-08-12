"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Building2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { setStoredActiveClinicId } from "@/services/clinicUsers";

import {
  getMyOrganization,
  getOrganizationBranches,
  switchActiveBranch,
  OrganizationBranch,
} from "@/services/organizations";

import { Organization } from "@/types/organization";

export default function BranchSwitcher() {
  const { organizationUser, profile } = useAuth();

  const [organization, setOrganization] =
    useState<Organization | null>(null);

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [switching, setSwitching] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!organizationUser) return;

    Promise.all([
      getMyOrganization(organizationUser.organization_id),
      getOrganizationBranches(organizationUser.organization_id),
    ])
      .then(([org, branchRows]) => {
        setOrganization(org);
        setBranches(branchRows);
      })
      .catch((error) => {
        console.error(
          "[BranchSwitcher] Failed to load organization/branches:",
          error
        );
      });
  }, [organizationUser]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return branches;

    return branches.filter((branch) =>
      branch.name.toLowerCase().includes(query)
    );
  }, [branches, search]);

  const currentBranchName = profile
    ? branches.find((branch) => branch.id === profile.clinic_id)?.name
    : null;

  async function handleSelectBranch(clinicId: string) {
    if (switching) return;

    try {
      setSwitching(true);

      await switchActiveBranch(clinicId);

      // Every /admin page fetches its own clinic-scoped data once on
      // mount - only a full reload guarantees none of it is stale.
      window.location.href = "/admin";
    } catch (error) {
      console.error("[BranchSwitcher] switchActiveBranch failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to switch into this branch."
      );

      setSwitching(false);
    }
  }

  function handleSelectAllBranches() {
    setOpen(false);

    // Without this, AuthContext.loadProfile() re-resolves the stale
    // stored clinic on the reload below (getCurrentClinicUser() still
    // finds it) and sets `profile` right back to it - "All Branches"
    // mode is only entered when nothing is stored (see the
    // `if (orgData && !getStoredActiveClinicId())` check in
    // contexts/AuthContext.tsx), so clearing here is what actually makes
    // the mode switch stick instead of silently reverting to whichever
    // branch was active before.
    setStoredActiveClinicId(null);

    window.location.href = "/admin/organization/overview";
  }

  if (!organizationUser) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-sea-glass bg-porcelain px-3 py-2 text-sm text-graphite transition-colors hover:border-mineral/50"
      >
        <Building2 size={16} className="text-eucalyptus" />

        <span className="max-w-64 truncate font-medium">
          {organization?.name ?? "Organization"}
          {" → "}
          {currentBranchName ?? "All Branches"}
        </span>

        <ChevronDown
          size={16}
          className={`transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-40 w-80 rounded-lg border border-sea-glass bg-enamel shadow-xl">
          <div className="border-b border-sea-glass p-3">
            <div className="flex items-center gap-2 rounded-lg border border-sea-glass bg-porcelain px-3 py-2">
              <Search size={15} className="text-mineral" />

              <input
                autoFocus
                placeholder="Search branches..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-sm text-graphite placeholder:text-mineral focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto py-2">
            <button
              type="button"
              onClick={handleSelectAllBranches}
              className="flex w-full items-center px-4 py-2.5 text-left text-sm font-semibold text-eucalyptus hover:bg-porcelain"
            >
              All Branches
            </button>

            <div className="my-1 border-t border-sea-glass" />

            {filteredBranches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-mineral">
                No branches found.
              </p>
            ) : (
              filteredBranches.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  disabled={switching}
                  onClick={() => handleSelectBranch(branch.id)}
                  className={`flex w-full items-center px-4 py-2.5 text-left text-sm hover:bg-porcelain disabled:cursor-not-allowed disabled:opacity-50 ${
                    branch.id === profile?.clinic_id
                      ? "font-semibold text-graphite"
                      : "text-graphite"
                  }`}
                >
                  {branch.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
