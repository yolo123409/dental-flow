"use client";

import useOrganization from "@/hooks/useOrganization";

import LoadingSpinner from "@/components/ui/LoadingSpinner";
import AccessDenied from "./AccessDenied";

interface Props {
  children: React.ReactNode;
}

/**
 * CEO is an organization-level capability, entirely separate from
 * lib/permissions.ts's clinic-level roles (Owner/Admin/Dentist/
 * Receptionist) - a CEO is simply 'Owner' in whichever branch is
 * active, exactly like an independent clinic's creator. This guard
 * gates organization-only pages (branch management, org dashboard,
 * consolidated financials) without touching the clinic permission
 * system at all.
 */
export default function CeoGuard({
  children,
}: Props) {
  const { isCeo, loading } =
    useOrganization();

  if (loading) {
    return <LoadingSpinner text="Loading organization..." />;
  }

  if (!isCeo) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
