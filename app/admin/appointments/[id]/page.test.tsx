import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "appt-1" }),
  useRouter: () => ({ back: vi.fn() }),
}));

vi.mock("@/components/auth/PermissionGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const hasPermission = vi.fn();
vi.mock("@/hooks/usePermissions", () => ({
  default: () => ({
    role: "Owner",
    hasPermission: (permission: string) => hasPermission(permission),
  }),
}));

const getAppointmentById = vi.fn();
const completeAppointment = vi.fn();
const markAppointmentCompleted = vi.fn();
vi.mock("@/services/appointments", () => ({
  getAppointmentById: (...args: unknown[]) => getAppointmentById(...args),
  completeAppointment: (...args: unknown[]) => completeAppointment(...args),
  markAppointmentCompleted: (...args: unknown[]) => markAppointmentCompleted(...args),
}));

const completeAndBillTreatmentItem = vi.fn();
vi.mock("@/services/treatmentPlans", () => ({
  completeAndBillTreatmentItem: (...args: unknown[]) =>
    completeAndBillTreatmentItem(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import AppointmentDetailsPage from "./page";

function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-1",
    patient_id: "patient-1",
    appointment_date: "2026-08-28",
    appointment_time: "10:00",
    duration: 30,
    treatment: "Root Canal - final visit",
    notes: null,
    status: "Scheduled",
    dentist_id: "dentist-1",
    dentists: { full_name: "Dr. Smith" },
    patients: { first_name: "Jane", last_name: "Doe" },
    treatment_plan_item_id: null,
    treatment_plan_items: null,
    ...overrides,
  };
}

function linkedTreatment(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    procedure: "Root Canal",
    status: "In Progress",
    charge_id: "charge-1",
    ...overrides,
  };
}

beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockReturnValue(true);
  getAppointmentById.mockReset();
  completeAppointment.mockReset();
  completeAndBillTreatmentItem.mockReset();
  markAppointmentCompleted.mockReset();
  markAppointmentCompleted.mockResolvedValue(true);
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("Appointment detail page - direct 'Treatment Completed' action", () => {
  it("shows the button for a linked, incomplete, non-cancelled treatment when the user has treatments permission", async () => {
    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    render(<AppointmentDetailsPage />);

    expect(
      await screen.findByRole("button", { name: "Treatment Completed" })
    ).toBeInTheDocument();
  });

  it("does not show the button (or the card) for an unlinked appointment", async () => {
    getAppointmentById.mockResolvedValue(makeAppointment());

    render(<AppointmentDetailsPage />);

    await screen.findByText("Appointment Details");

    expect(screen.queryByText("Treatment Completion")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Treatment Completed" })
    ).not.toBeInTheDocument();
  });

  it("shows a non-actionable completed indicator, not a button, once the treatment is already Completed", async () => {
    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment({ status: "Completed" }),
      })
    );

    render(<AppointmentDetailsPage />);

    await screen.findByText("Treatment Completion");

    expect(
      screen.queryByRole("button", { name: "Treatment Completed" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Treatment Completed")).toBeInTheDocument();
  });

  it("does not show the card at all for a Cancelled treatment", async () => {
    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment({
          status: "Cancelled",
          charge_id: null,
        }),
      })
    );

    render(<AppointmentDetailsPage />);

    await screen.findByText("Appointment Details");

    expect(screen.queryByText("Treatment Completion")).not.toBeInTheDocument();
  });

  it("hides the button when the current user lacks 'treatments' permission", async () => {
    hasPermission.mockImplementation(
      (permission: string) => permission !== "treatments"
    );

    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    render(<AppointmentDetailsPage />);

    await screen.findByText("Appointment Details");

    expect(screen.queryByText("Treatment Completion")).not.toBeInTheDocument();
  });

  it("opens a 'Complete Treatment?' confirmation dialog when clicked, and Cancel makes no call", async () => {
    const user = userEvent.setup();

    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    render(<AppointmentDetailsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Treatment Completed" })
    );

    expect(await screen.findByText("Complete Treatment?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Complete Treatment?")).not.toBeInTheDocument();
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("confirming calls completeAndBillTreatmentItem with the linked item's id and shows the invoice-created message", async () => {
    const user = userEvent.setup();

    getAppointmentById.mockResolvedValueOnce(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    completeAndBillTreatmentItem.mockResolvedValue({
      item: { id: "item-1", status: "Completed" },
      treatmentCompleted: true,
      invoiced: true,
      billingDeferred: false,
    });

    getAppointmentById.mockResolvedValueOnce(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment({ status: "Completed" }),
      })
    );

    render(<AppointmentDetailsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Treatment Completed" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Complete Treatment" })
    );

    expect(completeAndBillTreatmentItem).toHaveBeenCalledWith("item-1");
    // Full-app audit fix H5: completing the linked treatment directly must
    // also complete the appointment itself - previously this path left an
    // appointment still "Scheduled" even though its own treatment just
    // finished.
    expect(markAppointmentCompleted).toHaveBeenCalledWith("appt-1");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Treatment completed and invoice created."
    );

    // UI reflects the refetched, now-Completed state - actionable button
    // gone, replaced by the non-actionable indicator.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Treatment Completed" })
      ).not.toBeInTheDocument();
    });
  });

  it("shows the billing-deferred message when the treatment completes but billing lacks authorization", async () => {
    const user = userEvent.setup();

    getAppointmentById.mockResolvedValueOnce(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    completeAndBillTreatmentItem.mockResolvedValue({
      item: { id: "item-1", status: "Completed" },
      treatmentCompleted: true,
      invoiced: false,
      billingDeferred: true,
    });

    getAppointmentById.mockResolvedValueOnce(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment({ status: "Completed" }),
      })
    );

    render(<AppointmentDetailsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Treatment Completed" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Complete Treatment" })
    );

    expect(toastSuccess).toHaveBeenCalledWith(
      "Treatment completed. Billing is pending authorization."
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows 'Treatment was already completed.' when the atomic RPC lost the race (idempotent null return)", async () => {
    const user = userEvent.setup();

    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    completeAndBillTreatmentItem.mockResolvedValue({
      item: null,
      treatmentCompleted: false,
      invoiced: false,
      billingDeferred: false,
    });

    render(<AppointmentDetailsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Treatment Completed" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Complete Treatment" })
    );

    expect(toastError).toHaveBeenCalledWith("Treatment was already completed.");
    expect(toastSuccess).not.toHaveBeenCalledWith(
      expect.stringContaining("invoice")
    );
  });

  it("never calls completeAndBillTreatmentItem just from loading the page - a multi-visit treatment isn't auto-completed by an earlier visit", async () => {
    getAppointmentById.mockResolvedValue(
      makeAppointment({
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    render(<AppointmentDetailsPage />);

    await screen.findByRole("button", { name: "Treatment Completed" });

    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });

  it("leaves the existing 'Mark as Completed' -> appointment-only flow unchanged", async () => {
    const user = userEvent.setup();

    getAppointmentById.mockResolvedValue(
      makeAppointment({
        status: "Scheduled",
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      })
    );

    completeAppointment.mockResolvedValue({
      appointment: makeAppointment({
        status: "Completed",
        treatment_plan_item_id: "item-1",
        treatment_plan_items: linkedTreatment(),
      }),
      alreadyCompleted: false,
      treatmentCompleted: false,
      invoiced: false,
      billingDeferred: false,
    });

    render(<AppointmentDetailsPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Mark this appointment as completed",
      })
    );

    expect(
      await screen.findByText("Is this treatment fully complete?")
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Not yet - just complete the appointment",
      })
    );

    expect(completeAppointment).toHaveBeenCalledWith("appt-1", {
      completeTreatment: false,
    });
    expect(completeAndBillTreatmentItem).not.toHaveBeenCalled();
  });
});
