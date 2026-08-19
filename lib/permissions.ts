export type UserRole =
  | "Owner"
  | "Admin"
  | "Dentist"
  | "Receptionist";

/** Roles that can be assigned through a staff invitation. Owner is never invited. */
export type InvitableRole = Exclude<UserRole, "Owner">;

export const INVITABLE_ROLES: InvitableRole[] = [
  "Admin",
  "Dentist",
  "Receptionist",
];

export type Permission =
  | "dashboard"
  | "patients"
  | "appointments"
  | "calendar"
  | "treatments"
  | "documents"
  | "billing"
  | "payments"
  | "inventory"
  | "inventory_manage"
  | "procurement"
  | "procurement_manage"
  | "money_out"
  | "money_out_manage"
  | "users"
  | "analytics"
  | "settings"
  | "treatment_profitability"
  | "treatment_profitability_manage"
  | "ledger"
  | "ledger_manage"
  | "accounts_payable"
  | "accounts_payable_manage";

export const permissions: Record<UserRole, ("*" | Permission)[]> = {
  Owner: ["*"],

  Admin: ["*"],

  Dentist: [
    "dashboard",
    "patients",
    "appointments",
    "calendar",
    "treatments",
    "documents",
  ],

  Receptionist: [
    "dashboard",
    "patients",
    "appointments",
    "calendar",
    "billing",
    "payments",
    "inventory",
    "inventory_manage",
    "procurement",
    "procurement_manage",
    "money_out",
    "money_out_manage",
  ],
};

export function canAccess(
  role: UserRole,
  permission: Permission
): boolean {
  // Fails closed (not a thrown error) for a role string that isn't one
  // of the four defined above - e.g. stale/corrupted data, or a future
  // clinic_users.role value added to the database before this map is
  // updated to match - so every caller (PermissionGuard, usePermissions,
  // assertPermission) can treat "no access" and "unrecognized role" the
  // same way without each needing its own guard.
  const allowed = permissions[role] ?? [];

  return allowed.includes("*") || allowed.includes(permission);
}