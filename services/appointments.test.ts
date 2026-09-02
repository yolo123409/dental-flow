import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentClinicId = vi.fn();

vi.mock("@/services/clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

const notifyAppointmentBooked = vi.fn();
const notifyAppointmentCancelled = vi.fn();
const notifyAppointmentCompleted = vi.fn();
const notifyAppointmentRescheduled = vi.fn();

vi.mock("@/services/notifications", () => ({
  notifyAppointmentBooked: (...args: unknown[]) => notifyAppointmentBooked(...args),
  notifyAppointmentCancelled: (...args: unknown[]) => notifyAppointmentCancelled(...args),
  notifyAppointmentCompleted: (...args: unknown[]) => notifyAppointmentCompleted(...args),
  notifyAppointmentRescheduled: (...args: unknown[]) => notifyAppointmentRescheduled(...args),
}));

const completeAndBillTreatmentItem = vi.fn();

vi.mock("@/services/treatmentPlans", () => ({
  completeAndBillTreatmentItem: (...args: unknown[]) =>
    completeAndBillTreatmentItem(...args),
}));

/**
 * completeAppointment() only ever touches the "appointments" table, and
 * its own call sequence is fixed and known (fetch existing -> conditional
 * update -> optional getAppointmentById refetch) - so a simple queue of
 * canned responses, consumed in call order, is enough; no per-table
 * dispatch is needed the way services/billing.test.ts's mock needs for
 * its multi-table functions.
 */
function createAppointmentsMock(
  responses: Array<{ data: unknown; error: unknown }>
) {
  let index = 0;

  const builder = {
    select: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    order: () => builder,
    range: () => builder,
    single: () => builder,
    maybeSingle: () => builder,
    then(
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown
    ) {
      const result = responses[index] ?? { data: null, error: null };
      index += 1;
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return { from: () => builder };
}

let mockClient: ReturnType<typeof createAppointmentsMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const { completeAppointment, markAppointmentCompleted, updateAppointment, deleteAppointment } =
  await import("./appointments");

const CLINIC_ID = "clinic-a";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  notifyAppointmentBooked.mockReset();
  notifyAppointmentCancelled.mockReset();
  notifyAppointmentCompleted.mockReset();
  notifyAppointmentRescheduled.mockReset();
  completeAndBillTreatmentItem.mockReset();
});

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-1",
    status: "Completed",
    treatment: "Root Canal",
    treatment_plan_item_id: null,
    patients: { first_name: "Jane", last_name: "Doe" },
    dentists: { full_name: "Dr. Smith" },
    treatment_plan_items: null,
    ...overrides,
  };
}

describe("completeAppointment (Phase B/C - the appointment-completion entry point)", () => {
  it("throws when the appointment doesn't exist in this clinic", async () => {
    mockClient = createAppointmentsMock([{ data: null, error: null }]);

    await expect(completeAppointment("missing")).rejects.toThrow(
      /not found/i
    );

    expect(notifyAppointmentCompleted).not.toHaveBeenCalled();
  });

  it("is idempotent when the appointment is already Completed - no notification, no treatment completion attempt", async () => {
    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Completed", treatment: "Root Canal", treatment_plan_item_id: null }, error: null },
      { data: makeAppointment(), error: null },
    ]);

    const result = await completeAppointment("appt-1");

    expect(result.alreadyCompleted).toBe(true);
    expect(result.treatmentCompleted).toBe(false);
    expect(notifyAppointmentCompleted).not.toHaveBeenCalled();
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("treats a lost conditional-update race exactly like already-completed (same-appointment concurrency)", async () => {
    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Scheduled", treatment: "Root Canal", treatment_plan_item_id: null }, error: null },
      // The conditional `.neq("status", "Completed")` update matched zero
      // rows - another concurrent request already completed it first.
      { data: null, error: null },
      { data: makeAppointment(), error: null },
    ]);

    const result = await completeAppointment("appt-1");

    expect(result.alreadyCompleted).toBe(true);
    expect(notifyAppointmentCompleted).not.toHaveBeenCalled();
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("completes an unlinked appointment exactly like the existing behavior - no treatment, no billing", async () => {
    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Scheduled", treatment: "Consultation", treatment_plan_item_id: null }, error: null },
      { data: { id: "appt-1", treatment: "Consultation" }, error: null },
      { data: makeAppointment({ treatment: "Consultation" }), error: null },
    ]);

    const result = await completeAppointment("appt-1", { completeTreatment: true });

    expect(result.alreadyCompleted).toBe(false);
    expect(result.treatmentCompleted).toBe(false);
    expect(result.invoiced).toBe(false);
    expect(notifyAppointmentCompleted).toHaveBeenCalledWith({
      id: "appt-1",
      treatment: "Consultation",
    });
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("completes a linked appointment without confirming the treatment when completeTreatment is not requested", async () => {
    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Scheduled", treatment: "Root Canal - visit 1", treatment_plan_item_id: "item-1" }, error: null },
      { data: { id: "appt-1", treatment: "Root Canal - visit 1" }, error: null },
      { data: makeAppointment(), error: null },
    ]);

    const result = await completeAppointment("appt-1");

    expect(result.treatmentCompleted).toBe(false);
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("confirms and bills the linked treatment when completeTreatment is requested, passing through the payment method/insurance provider", async () => {
    completeAndBillTreatmentItem.mockResolvedValue({
      item: { id: "item-1" },
      treatmentCompleted: true,
      invoiced: true,
      billingDeferred: false,
    });

    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Scheduled", treatment: "Root Canal - final visit", treatment_plan_item_id: "item-1" }, error: null },
      { data: { id: "appt-1", treatment: "Root Canal - final visit" }, error: null },
      { data: makeAppointment(), error: null },
    ]);

    const result = await completeAppointment("appt-1", {
      completeTreatment: true,
      paymentMethod: "Cash",
      insuranceProviderId: null,
    });

    expect(completeAndBillTreatmentItem).toHaveBeenCalledWith(
      "item-1",
      "Cash",
      null
    );
    expect(result.treatmentCompleted).toBe(true);
    expect(result.invoiced).toBe(true);
    expect(result.billingDeferred).toBe(false);
  });

  it("still reports the appointment as completed when billing is deferred for lack of permission - never blocks completion", async () => {
    completeAndBillTreatmentItem.mockResolvedValue({
      item: { id: "item-1" },
      treatmentCompleted: true,
      invoiced: false,
      billingDeferred: true,
    });

    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", status: "Scheduled", treatment: "Root Canal", treatment_plan_item_id: "item-1" }, error: null },
      { data: { id: "appt-1", treatment: "Root Canal" }, error: null },
      { data: makeAppointment(), error: null },
    ]);

    const result = await completeAppointment("appt-1", { completeTreatment: true });

    expect(result.alreadyCompleted).toBe(false);
    expect(result.treatmentCompleted).toBe(true);
    expect(result.billingDeferred).toBe(true);
    expect(result.invoiced).toBe(false);
  });
});

describe("markAppointmentCompleted (full-app audit fix H5 - the shared primitive completeAppointment() and the appointment detail page's direct 'Treatment Completed' action both use)", () => {
  it("flips status to Completed and notifies, returning true", async () => {
    mockClient = createAppointmentsMock([
      { data: { id: "appt-1", treatment: "Root Canal" }, error: null },
    ]);

    const result = await markAppointmentCompleted("appt-1");

    expect(result).toBe(true);
    expect(notifyAppointmentCompleted).toHaveBeenCalledWith({
      id: "appt-1",
      treatment: "Root Canal",
    });
  });

  it("is a no-op returning false when the appointment is already Completed (the conditional update matches zero rows)", async () => {
    mockClient = createAppointmentsMock([{ data: null, error: null }]);

    const result = await markAppointmentCompleted("appt-1");

    expect(result).toBe(false);
    expect(notifyAppointmentCompleted).not.toHaveBeenCalled();
  });
});

describe("updateAppointment (full-app audit fix C5 - Critical)", () => {
  it("rejects status: \"Completed\" before making any database call - completion must go through completeAppointment()/markAppointmentCompleted() instead, which also handle billing for a linked treatment", async () => {
    mockClient = createAppointmentsMock([]);

    await expect(
      updateAppointment("appt-1", { status: "Completed" })
    ).rejects.toThrow(/completeAppointment/i);

    expect(getCurrentClinicId).not.toHaveBeenCalled();
  });

  // Critical Safety Closure fix (Audit II, Critical #1): the guard above
  // only ever checked the INCOMING status value - a Completed
  // appointment's own EXISTING row was never checked, so it could be
  // silently reverted/rewritten back through this same function by
  // submitting any OTHER status. This is the second, previously-missing
  // guard: reject any edit to an appointment whose current row is
  // already Completed, regardless of what's being submitted.
  it("rejects any edit to an appointment whose EXISTING status is already Completed, even when the incoming status is something else entirely", async () => {
    mockClient = createAppointmentsMock([
      {
        data: {
          status: "Completed",
          appointment_date: "2026-01-10",
          appointment_time: "09:00",
          treatment: "Root Canal",
          dentist_id: "dentist-1",
          duration: 60,
        },
        error: null,
      },
    ]);

    await expect(
      updateAppointment("appt-1", { status: "Scheduled" })
    ).rejects.toThrow(/historical records and cannot be edited/i);
  });

  it("still allows editing a non-Completed appointment normally (no schedule change, so no conflict check is triggered)", async () => {
    mockClient = createAppointmentsMock([
      {
        data: {
          status: "Scheduled",
          appointment_date: "2026-01-10",
          appointment_time: "09:00",
          treatment: "Root Canal",
          dentist_id: "dentist-1",
          duration: 60,
        },
        error: null,
      },
      { data: null, error: null },
    ]);

    await expect(
      updateAppointment("appt-1", { notes: "Patient requested a reminder call." })
    ).resolves.toBeUndefined();
  });
});

describe("deleteAppointment (full-app audit fix H6)", () => {
  it("refuses to delete a Completed appointment - it's a historical clinical/billing record", async () => {
    mockClient = createAppointmentsMock([
      { data: { status: "Completed" }, error: null },
    ]);

    await expect(deleteAppointment("appt-1")).rejects.toThrow(
      /historical records and cannot be deleted/i
    );
  });

  it("still allows deleting a non-Completed appointment", async () => {
    mockClient = createAppointmentsMock([
      { data: { status: "Scheduled" }, error: null },
      { data: null, error: null },
    ]);

    await expect(deleteAppointment("appt-1")).resolves.toBeUndefined();
  });
});
