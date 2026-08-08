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

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace("/auth/login");
      return;
    }

    // An organization member with no active clinic_users row has one of
    // two reasons: their organization has no branches yet (route to
    // first-branch onboarding), or it has branches but none is selected
    // this session (route to Organization Overview - e.g. a fresh login,
    // or "All Branches"). hasOrganizationBranches is resolved once in
    // AuthContext, not re-fetched per navigation.
    if (!loading && authUser && !profile && organizationUser) {
      const target = hasOrganizationBranches
        ? ORGANIZATION_OVERVIEW_PATH
        : FIRST_BRANCH_ONBOARDING_PATH;

      if (pathname !== target) {
        router.replace(target);
      }
    }
  }, [
    loading,
    authUser,
    profile,
    organizationUser,
    hasOrganizationBranches,
    pathname,
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

  // Must mirror the redirect condition in the effect above exactly. An
  // organization member with no active clinic_users row (no clinic
  // selected/created yet) has no clinic_id anywhere in the system - if
  // `children` were rendered here for even one pass before the redirect
  // effect navigates away, AdminLayout and every clinic-scoped
  // hook/widget it mounts (dashboard, notifications, inventory
  // attention count, overdue-invoice check, ...) would fire their
  // fetches against a nonexistent clinic and log failures. Rendering the
  // loading state instead, until the pathname actually matches the
  // redirect target, keeps clinic-scoped children from ever mounting
  // during this state.
  if (!profile && organizationUser) {
    const target = hasOrganizationBranches
      ? ORGANIZATION_OVERVIEW_PATH
      : FIRST_BRANCH_ONBOARDING_PATH;

    if (pathname !== target) {
      return (
        <div className="flex h-screen items-center justify-center">
          <p className="text-slate-500">
            Loading...
          </p>
        </div>
      );
    }
  }

  return <>{children}</>;
}
