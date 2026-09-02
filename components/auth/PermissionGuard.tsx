"use client";

import { Permission } from "@/lib/permissions";

import usePermissions from "@/hooks/usePermissions";

import AccessDenied from "./AccessDenied";

interface Props {
  permission: Permission;
  /**
   * Full-app audit fix H17: lets a page admit its viewer even without
   * `permission` for a specific, narrow reason the page itself decides
   * (e.g. viewing your own staff profile) - never a blanket permission
   * change, just a per-page carve-out.
   */
  bypass?: boolean;
  children: React.ReactNode;
}

export default function PermissionGuard({
  permission,
  bypass = false,
  children,
}: Props) {

  const { hasPermission } =
    usePermissions();

  if (!hasPermission(permission) && !bypass) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}