import { describe, expect, it } from "vitest";

import { canAccess, permissions, UserRole } from "./permissions";

describe("canAccess", () => {
  it.each([
    ["Owner", "patients"],
    ["Owner", "billing"],
    ["Owner", "ledger"],
    ["Owner", "users"],
    ["Owner", "settings"],
    ["Admin", "patients"],
    ["Admin", "billing"],
    ["Admin", "ledger"],
    ["Admin", "users"],
    ["Admin", "settings"],
  ] as const)("%s has full (*) access, including %s", (role, permission) => {
    expect(canAccess(role, permission)).toBe(true);
  });

  it.each([
    ["Dentist", "dashboard"],
    ["Dentist", "patients"],
    ["Dentist", "appointments"],
    ["Dentist", "calendar"],
    ["Dentist", "treatments"],
    ["Dentist", "documents"],
  ] as const)("Dentist can access %s (%s)", (role, permission) => {
    expect(canAccess(role, permission)).toBe(true);
  });

  it.each([
    ["Dentist", "billing"],
    ["Dentist", "payments"],
    ["Dentist", "ledger"],
    ["Dentist", "ledger_manage"],
    ["Dentist", "accounts_payable"],
    ["Dentist", "treatment_profitability"],
    ["Dentist", "analytics"],
    ["Dentist", "users"],
    ["Dentist", "settings"],
    ["Dentist", "inventory"],
    ["Dentist", "money_out"],
  ] as const)(
    "Dentist is blocked from %s (%s) - accounting/admin pages must stay off-limits",
    (role, permission) => {
      expect(canAccess(role, permission)).toBe(false);
    }
  );

  it.each([
    ["Receptionist", "dashboard"],
    ["Receptionist", "patients"],
    ["Receptionist", "appointments"],
    ["Receptionist", "calendar"],
    ["Receptionist", "billing"],
    ["Receptionist", "payments"],
    ["Receptionist", "inventory"],
    ["Receptionist", "inventory_manage"],
    ["Receptionist", "procurement"],
    ["Receptionist", "procurement_manage"],
    ["Receptionist", "money_out"],
    ["Receptionist", "money_out_manage"],
  ] as const)("Receptionist can access %s (%s)", (role, permission) => {
    expect(canAccess(role, permission)).toBe(true);
  });

  it.each([
    ["Receptionist", "ledger"],
    ["Receptionist", "ledger_manage"],
    ["Receptionist", "accounts_payable"],
    ["Receptionist", "treatment_profitability"],
    ["Receptionist", "analytics"],
    ["Receptionist", "users"],
    ["Receptionist", "settings"],
    ["Receptionist", "treatments"],
    ["Receptionist", "documents"],
  ] as const)(
    "Receptionist is blocked from %s (%s) - accounting/admin/clinical pages must stay off-limits",
    (role, permission) => {
      expect(canAccess(role, permission)).toBe(false);
    }
  );

  it("an unknown/missing role has no access to anything", () => {
    // canAccess is only ever called with a real UserRole in practice
    // (usePermissions()/assertPermission() both check for a null role
    // separately before calling it), but the function itself must still
    // fail closed rather than throw or fall through to some implicit
    // allow if it's ever handed one.
    const bogusRole = "Someone" as UserRole;

    expect(canAccess(bogusRole, "dashboard")).toBe(false);
  });

  it("every defined role has at least one permission (no accidental empty array)", () => {
    for (const role of Object.keys(permissions) as UserRole[]) {
      expect(permissions[role].length).toBeGreaterThan(0);
    }
  });
});
