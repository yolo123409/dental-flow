import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentClinicUser = vi.fn();

vi.mock("./clinicUsers", () => ({
  getCurrentClinicUser: () => getCurrentClinicUser(),
}));

import { assertPermission, AuthorizationError } from "./authorization";

describe("assertPermission", () => {
  beforeEach(() => {
    getCurrentClinicUser.mockReset();
  });

  it("resolves for a role that has the permission", async () => {
    getCurrentClinicUser.mockResolvedValue({ role: "Owner" });

    await expect(assertPermission("ledger")).resolves.toBeUndefined();
  });

  it("resolves for a role granted the permission specifically (not via *)", async () => {
    getCurrentClinicUser.mockResolvedValue({ role: "Receptionist" });

    await expect(assertPermission("billing")).resolves.toBeUndefined();
  });

  it("throws AuthorizationError for a role that lacks the permission", async () => {
    getCurrentClinicUser.mockResolvedValue({ role: "Dentist" });

    await expect(assertPermission("ledger")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("throws AuthorizationError for a role that lacks the permission (accounts_payable)", async () => {
    getCurrentClinicUser.mockResolvedValue({ role: "Receptionist" });

    await expect(assertPermission("accounts_payable")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("throws AuthorizationError when there is no clinic_users row at all", async () => {
    getCurrentClinicUser.mockResolvedValue(null);

    await expect(assertPermission("dashboard")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });
});
