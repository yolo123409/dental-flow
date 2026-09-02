import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentClinicId = vi.fn();
vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

const assertPermission = vi.fn();
vi.mock("./authorization", () => ({
  assertPermission: (...args: unknown[]) => assertPermission(...args),
}));

function makeCountBuilder(count: number, error: unknown = null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ count, error }).then(resolve),
  };
  return builder;
}

function makeDeleteBuilder(error: unknown = null) {
  const builder = {
    delete: () => builder,
    eq: () => builder,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error }).then(resolve),
  };
  return builder;
}

let appointmentCount = 0;
let appointmentCountError: unknown = null;
let deleteError: unknown = null;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return {
      from: (table: string) => {
        if (table === "appointments") {
          return makeCountBuilder(appointmentCount, appointmentCountError);
        }
        if (table === "dentists") {
          return makeDeleteBuilder(deleteError);
        }
        throw new Error(`Unexpected table in test: ${table}`);
      },
    };
  },
}));

const { deleteDentist } = await import("./dentists");

const CLINIC_ID = "clinic-1";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  assertPermission.mockReset();
  assertPermission.mockResolvedValue(undefined);
  appointmentCount = 0;
  appointmentCountError = null;
  deleteError = null;
});

describe("deleteDentist (full-app audit fix H7)", () => {
  it("checks the 'patients' permission - matching the Dentists page's own PermissionGuard - before doing anything else", async () => {
    appointmentCount = 0;

    await deleteDentist("dentist-1");

    expect(assertPermission).toHaveBeenCalledWith("patients");
  });

  it("refuses to delete a dentist who has any appointment history, directing to deactivate instead", async () => {
    appointmentCount = 3;

    await expect(deleteDentist("dentist-1")).rejects.toThrow(
      /appointment history and cannot be deleted/i
    );
  });

  it("still allows deleting a dentist with zero appointments", async () => {
    appointmentCount = 0;

    await expect(deleteDentist("dentist-1")).resolves.toBeUndefined();
  });

  it("propagates a failure counting appointments rather than proceeding to delete", async () => {
    appointmentCountError = { message: "boom" };

    await expect(deleteDentist("dentist-1")).rejects.toBeTruthy();
  });
});
