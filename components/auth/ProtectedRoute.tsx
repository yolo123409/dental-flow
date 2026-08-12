"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";

const FIRST_BRANCH_ONBOARDING_PATH = "/auth/onboarding/first-branch";
const ORGANIZATION_OVERVIEW_PATH = "/admin/organization/overview";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const {
    authUser,
    profile,
    organizationUser,
    hasOrganizationBranches,
    loading,
  } = useAuth();

  // Every page under /admin/organization/* (Overview, Team & Access,
  // Settings) is organization-scoped, not clinic-scoped - none of them
  // mount the clinic-scoped children (AdminLayout's dashboard widgets,
  // notifications, inventory attention count, ...) this guard exists to
  // protect. The redirect below must only fire when the user is NOT
  // already somewhere in that namespace, otherwise every click from
  // Overview to Team/Settings gets immediately bounced back to Overview
  // the moment pathname changes and no longer equals the literal target.
  const isOrganizationRoute = pathname.startsWith("/admin/organization");

  // Set only via the admin API (app/api/auth/complete-password-change),
  // never by the client's own supabase.auth.updateUser({data}) - see
  // lib/supabase-request.ts. Checked ahead of every other redirect below:
  // a temp-password account must not reach any /admin/** page, organization
  // or clinic, until this is cleared.
  const mustChangePassword = Boolean(
    authUser?.app_metadata?.must_change_password
  );

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace("/auth/login");
      return;
    }

    if (!loading && authUser && mustChangePassword) {
      router.replace("/auth/change-password");
      return;
    }

    // An organization member with no active clinic_users row has one of
    // two reasons: their organization has no branches yet (route to
    // first-branch onboarding), or it has branches but none is selected
    // this session (route to Organization Overview - e.g. a fresh login,
    // or "All Branches"). hasOrganizationBranches is resolved once in
    // AuthContext, not re-fetched per navigation.
    if (
      !loading &&
      authUser &&
      !profile &&
      organizationUser &&
      !isOrganizationRoute
    ) {
      const target = hasOrganizationBranches
        ? ORGANIZATION_OVERVIEW_PATH
        : FIRST_BRANCH_ONBOARDING_PATH;

      router.replace(target);
    }
  }, [
    loading,
    authUser,
    mustChangePassword,
    profile,
    organizationUser,
    hasOrganizationBranches,
    isOrganizationRoute,
    router,
  ]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-slate-500">
          Loading...
        </p>
      </div>
    );
  }

  if (!authUser) {
    return null;
  }

  // Mirrors the mustChangePassword redirect above - never mount any
  // /admin/** children (clinic- or organization-scoped) for a temp-password
  // account, even for one render pass before the effect navigates away.
  if (mustChangePassword) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-slate-500">
          Loading...
        </p>
      </div>
    );
  }

  // Must mirror the redirect condition in the effect above exactly
  // (including the isOrganizationRoute exemption - see the comment by its
  // declaration). An organization member with no active clinic_users row
  // (no clinic selected/created yet) has no clinic_id anywhere in the
  // system - if `children` were rendered here for even one pass before
  // the redirect effect navigates away, AdminLayout and every
  // clinic-scoped hook/widget it mounts (dashboard, notifications,
  // inventory attention count, overdue-invoice check, ...) would fire
  // their fetches against a nonexistent clinic and log failures.
  // Rendering the loading state instead, until the pathname actually
  // matches the redirect target (or is already a safe organization page),
  // keeps clinic-scoped children from ever mounting during this state.
  if (!profile && organizationUser && !isOrganizationRoute) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-slate-500">
          Loading...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
