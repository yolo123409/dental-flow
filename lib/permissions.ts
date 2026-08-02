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
  | "users"
  | "analytics"
  | "settings";

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
  ],
};

export function canAccess(
  role: UserRole,
  permission: Permission
): boolean {
  const allowed = permissions[role];

  return allowed.includes("*") || allowed.includes(permission);
}