"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown } from "lucide-react";

import useOrganization from "@/hooks/useOrganization";
import { switchActiveBranch } from "@/services/organizations";
import { logError } from "@/lib/logError";

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
  const router = useRouter();

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

      // A page the user was on (e.g. a specific patient record) may
      // belong to the branch they're leaving and would 404/error under
      // the new branch's RLS scope - land on the dashboard, exactly like
      // the Branches page's own "Access Branch" button already does.
      router.push("/admin");
      router.refresh();
    } catch (error) {
      logError("[BranchSwitcher] Failed to switch branch:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to switch branches."
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
        onClick={() => setOpen((prev) => !prev)}
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
        <div className="max-h-64 overflow-y-auto rounded-lg border border-sea-glass bg-white py-1 shadow-lg">
          {myBranches.map((branch) => {
            const isActive = branch.id === activeBranch?.id;

            return (
              <button
                key={branch.id}
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
