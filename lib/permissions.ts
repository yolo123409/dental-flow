export type UserRole =
  | "Admin"
  | "Dentist"
  | "Receptionist";

export type Permission =
  | "dashboard"
  | "patients"
  | "appointments"
  | "calendar"
  | "treatments"
  | "documents"
  | "billing"
  | "payments"
  | "users"
  | "analytics"
  | "settings";

export const permissions: Record<UserRole, ("*" | Permission)[]> = {
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
  ],
};

export function canAccess(
  role: UserRole,
  permission: Permission
): boolean {
  const allowed = permissions[role];

  return allowed.includes("*") || allowed.includes(permission);
}