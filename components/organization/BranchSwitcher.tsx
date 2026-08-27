"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown } from "lucide-react";

import useOrganization from "@/hooks/useOrganization";
import { switchActiveBranch } from "@/services/organizations";
import { getSafeErrorMessage, logError } from "@/lib/logError";

/**
 * Quick branch switcher, rendered in the persistent Sidebar so it's
 * available on every /admin page - not just the CEO-only Branches page
 * (app/admin/organization/branches). Works for ANY organization member
 * (CEO or Member) who holds access to 2+ branches; this is what closes
 * the gap Phase 5 left open (a Member had no way at all to change which
 * branch they were viewing). A single-branch member falls back to the
 * same plain, read-only name display Phase 5 introduced - no dropdown
 * chrome for a choice that isn't actually a choice.
 *
 * switchActiveBranch (services/organizations.ts) is a pure UX
 * convenience, never a security boundary - the RPC itself re-verifies
 * the caller already holds a real clinic_users row for the target
 * branch, and myBranches below only ever lists branches RLS already
 * proved the caller has access to, so there is nothing here for a
 * client to "trick" into an unauthorized branch.
 */
export default function BranchSwitcher() {
  const { organizationUser, myBranches, activeBranch, reload } =
    useOrganization();

  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  if (!organizationUser) {
    return null;
  }

  async function handleSwitch(branchId: string) {
    if (branchId === activeBranch?.id) {
      setOpen(false);
      return;
    }

    try {
      setSwitchingId(branchId);

      await switchActiveBranch(branchId);
      await reload();

      setOpen(false);

      // A hard navigation, not router.push()/router.refresh(): every
      // clinic-scoped page (Dashboard, Patients, Ledger, ...) resolves
      // its clinic_id once in a mount-time useEffect and never re-reads
      // it - and AuthContext's own `profile` (role, used for permission
      // gating) is only reloaded on a real auth event, never on a branch
      // switch. A client-side push to "/admin" while the dropdown is
      // used FROM "/admin" itself is a no-op navigation (same pathname),
      // so nothing remounts and every widget silently keeps showing the
      // old branch's data - router.refresh() only re-runs server-side
      // data fetching, not these client-side effects. A full reload
      // remounts everything (including AuthProvider/OrganizationProvider
      // themselves), which is the only way to guarantee every already-
      // mounted piece of UI picks up the new branch. Same fix applied to
      // the Branches page's own "Access Branch" button, which had this
      // identical latent bug - it just never surfaced there because
      // that button is always clicked from a different route than
      // "/admin", which happened to force a real remount anyway.
      window.location.href = "/admin";
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Unable to switch branches.",
          "[BranchSwitcher] Failed to switch branch:"
        )
      );
    } finally {
      setSwitchingId(null);
    }
  }

  if (myBranches.length <= 1) {
    return (
      <div className="border-b border-sea-glass px-8 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-mineral">
          Active Branch
        </p>

        <p className="mt-1 truncate font-semibold text-graphite">
          {activeBranch?.name ?? "Loading..."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative border-b border-sea-glass px-8 py-4"
    >
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-mineral">
        Active Branch
      </p>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Active branch"
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-sea-glass bg-white px-3 py-2 text-left transition hover:bg-porcelain"
      >
        <span className="truncate font-semibold text-graphite">
          {activeBranch?.name ?? "Loading..."}
        </span>

        <ChevronDown
          size={16}
          className={`shrink-0 text-mineral transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`absolute left-8 right-8 top-full z-40 mt-1 origin-top transition-all duration-150 ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div
          role="listbox"
          aria-label="Branches"
          className="max-h-64 overflow-y-auto rounded-lg border border-sea-glass bg-white py-1 shadow-lg"
        >
          {myBranches.map((branch) => {
            const isActive = branch.id === activeBranch?.id;

            return (
              <button
                key={branch.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSwitch(branch.id)}
                disabled={switchingId !== null}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-graphite transition hover:bg-porcelain disabled:opacity-60"
              >
                <span className="truncate">
                  {switchingId === branch.id
                    ? "Switching..."
                    : branch.name}
                </span>

                {isActive && (
                  <Check
                    size={15}
                    className="shrink-0 text-eucalyptus"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
