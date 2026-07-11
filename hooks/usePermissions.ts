"use client";

import { useAuth } from "@/contexts/AuthContext";

import {
  canAccess,
  Permission,
  UserRole,
} from "@/lib/permissions";

export default function usePermissions() {
  const { profile } = useAuth();

  const role =
    (profile?.role as UserRole | undefined) ??
    null;

  function hasPermission(
    permission: Permission
  ) {
    if (!role) return false;

    return canAccess(role, permission);
  }

  return {
    role,
    hasPermission,
  };
}