"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  getCurrentOrganizationUser,
  getOrganizationBranches,
} from "@/services/organizations";
import { logError } from "@/lib/logError";

import { OrganizationUser, OrganizationBranch } from "@/types/organization";

interface OrganizationContextType {
  organizationUser: OrganizationUser | null;
  isCeo: boolean;
  // Every branch of the organization the CURRENT user actually has
  // clinic_users access to - RLS on `clinics` (unchanged since migration
  // 0001) does the scoping for free: a CEO holds a clinic_users row in
  // every branch they've created, so this is every branch for a CEO, and
  // only the specific branches a Member has actually been added to for
  // everyone else. See getOrganizationBranches for the full explanation.
  myBranches: OrganizationBranch[];
  // The branch matching organizationUser.active_clinic_id, resolved from
  // myBranches above - null only while still loading, or in the
  // unreachable edge case of active_clinic_id pointing at a branch the
  // user no longer has access to (getCurrentClinicUser's own fallback
  // resolution handles that case for data access; this is display-only).
  activeBranch: OrganizationBranch | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizationUser: null,
  isCeo: false,
  myBranches: [],
  activeBranch: null,
  loading: true,
  reload: async () => {},
});

/**
 * Provided once per /admin session (app/admin/layout.tsx), not a
 * per-component hook with its own local state. Sidebar, CeoGuard and
 * every organization page all read from this SAME instance, so calling
 * reload() after switchActiveBranch() (e.g. the Branches page's "Access
 * Branch" button) updates all of them together.
 *
 * Before this, hooks/useOrganization.ts held its own independent
 * useState per call site - switching branches from the Branches page
 * updated that page's own state, but the persistently-mounted Sidebar
 * (which never remounts across /admin/* navigation, since it lives in
 * the shared layout) kept showing the OLD active branch name until a
 * hard reload. Lifting the state into one shared context fixes that:
 * every consumer re-renders from the same source the instant reload()
 * resolves.
 *
 * Null/empty for every independent-clinic user (the overwhelmingly
 * common case) - getCurrentOrganizationUser() is a cheap query that
 * returns zero rows for them, never an error, and myBranches is never
 * fetched at all when there's no organization membership.
 */
export function OrganizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { authUser } = useAuth();

  const authUserId = authUser?.id ?? null;

  const [organizationUser, setOrganizationUser] =
    useState<OrganizationUser | null>(null);

  const [myBranches, setMyBranches] = useState<OrganizationBranch[]>([]);

  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!authUserId) {
      setOrganizationUser(null);
      setMyBranches([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const result = await getCurrentOrganizationUser();

      setOrganizationUser(result);

      if (result) {
        const branches = await getOrganizationBranches(
          result.organization_id
        );

        setMyBranches(branches);
      } else {
        setMyBranches([]);
      }
    } catch (error) {
      logError(
        "[OrganizationContext] Failed to load organization membership:",
        error
      );

      setOrganizationUser(null);
      setMyBranches([]);
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeBranch =
    myBranches.find(
      (branch) => branch.id === organizationUser?.active_clinic_id
    ) ?? null;

  return (
    <OrganizationContext.Provider
      value={{
        organizationUser,
        isCeo: organizationUser?.role === "CEO",
        myBranches,
        activeBranch,
        loading,
        reload,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganizationContext() {
  return useContext(OrganizationContext);
}
