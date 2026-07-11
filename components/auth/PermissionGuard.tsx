"use client";

import { Permission } from "@/lib/permissions";

import usePermissions from "@/hooks/usePermissions";

import AccessDenied from "./AccessDenied";

interface Props {
  permission: Permission;
  children: React.ReactNode;
}

export default function PermissionGuard({
  permission,
  children,
}: Props) {

  const { hasPermission } =
    usePermissions();

  if (!hasPermission(permission)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}