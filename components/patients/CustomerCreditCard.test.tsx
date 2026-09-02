import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const getPatientCredits = vi.fn();
const getPatientInvoices = vi.fn();
const reverseCustomerCreditApplication = vi.fn();
const hasPermission = vi.fn((_permission: string) => true);

vi.mock("@/services/customerCredits", () => ({
  getPatientCredits: (...args: unknown[]) => getPatientCredits(...args),
  reverseCustomerCreditApplication: (...args: unknown[]) => reverseCustomerCreditApplication(...args),
}));

vi.mock("@/services/billing", () => ({
  getPatientInvoices: (...args: unknown[]) => getPatientInvoices(...args),
}));

vi.mock("@/hooks/usePermissions", () => ({
  default: () => ({ role: "Owner", hasPermission: (p: string) => hasPermission(p) }),
}));

import CustomerCreditCard from "./CustomerCreditCard";
import { CustomerCreditWithInvoice } from "@/types/customerCredits";

function makeCredit(
  overrides: Partial<CustomerCreditWithInvoice> = {}
): CustomerCreditWithInvoice {
  return {
    id: "credit-1",
    clinic_id: "clinic-1",
    patient_id: "patient-1",
    source_invoice_id: "inv-1",
    amount: 200,
    remaining_amount: 200,
    notes: null,
    created_at: "2026-08-27T00:00:00.000Z",
    created_by: "user-1",
    updated_at: "2026-08-27T00:00:00.000Z",
    source_invoice: { invoice_number: "INV-00007" },
    ...overrides,
  };
}

describe("CustomerCreditCard", () => {
  it("displays the total available credit as the sum of every credit's remaining balance", async () => {
    getPatientCredits.mockResolvedValue([
      makeCredit({ id: "credit-1", remaining_amount: 200 }),
      makeCredit({ id: "credit-2", remaining_amount: 50 }),
    ]);
    getPatientInvoices.mockResolvedValue([]);

    render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

    expect(await screen.findByText("Available Credit")).toBeInTheDocument();
    expect(await screen.findByText((content) => content.includes("250.00"))).toBeInTheDocument();
  });

  it("shows each credit's history: source invoice, remaining/original amount, and status", async () => {
    getPatientCredits.mockResolvedValue([
      makeCredit({ id: "credit-1", amount: 200, remaining_amount: 50, source_invoice: { invoice_number: "INV-00007" } }),
    ]);
    getPatientInvoices.mockResolvedValue([]);

    render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

    expect(await screen.findByText("Credit from INV-00007")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows a Fully Used status and hides the action buttons once a credit's remaining balance is zero", async () => {
    getPatientCredits.mockResolvedValue([
      makeCredit({ id: "credit-1", amount: 200, remaining_amount: 0 }),
    ]);
    getPatientInvoices.mockResolvedValue([]);

    render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

    expect(await screen.findByText("Fully Used")).toBeInTheDocument();
    expect(screen.queryByText("Apply to Invoice")).not.toBeInTheDocument();
    expect(screen.queryByText("Refund")).not.toBeInTheDocument();
  });

  it("shows an empty state when the patient has no customer credit at all", async () => {
    getPatientCredits.mockResolvedValue([]);
    getPatientInvoices.mockResolvedValue([]);

    render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

    expect(await screen.findByText("No customer credit on file.")).toBeInTheDocument();
  });

  it("offers Apply to Invoice and Refund actions for a credit with a remaining balance", async () => {
    getPatientCredits.mockResolvedValue([makeCredit({ remaining_amount: 200 })]);
    getPatientInvoices.mockResolvedValue([]);

    render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

    expect(await screen.findByText("Apply to Invoice")).toBeInTheDocument();
    expect(screen.getByText("Refund")).toBeInTheDocument();
  });

  describe("full-app audit fix H8: reversing a mistakenly-applied credit", () => {
    it("offers Reverse Application once anything has been applied from a credit, even if it's since been fully used", async () => {
      getPatientCredits.mockResolvedValue([
        makeCredit({ id: "credit-1", amount: 200, remaining_amount: 0 }),
      ]);
      getPatientInvoices.mockResolvedValue([]);

      render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

      expect(await screen.findByText("Reverse Application")).toBeInTheDocument();
    });

    it("never offers Reverse Application for a credit that has never had anything applied from it", async () => {
      getPatientCredits.mockResolvedValue([
        makeCredit({ id: "credit-1", amount: 200, remaining_amount: 200 }),
      ]);
      getPatientInvoices.mockResolvedValue([]);

      render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

      await screen.findByText("Apply to Invoice");
      expect(screen.queryByText("Reverse Application")).not.toBeInTheDocument();
    });

    it("hides Reverse Application from a role without the 'ledger' permission, even when something has been applied", async () => {
      hasPermission.mockImplementation((p: string) => p !== "ledger");
      getPatientCredits.mockResolvedValue([
        makeCredit({ id: "credit-1", amount: 200, remaining_amount: 50 }),
      ]);
      getPatientInvoices.mockResolvedValue([]);

      render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

      await screen.findByText("Apply to Invoice");
      expect(screen.queryByText("Reverse Application")).not.toBeInTheDocument();

      hasPermission.mockReset();
      hasPermission.mockImplementation(() => true);
    });

    it("submits the reversal against the invoice picked in the modal, with the entered amount and reason", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();

      getPatientCredits.mockResolvedValue([
        makeCredit({ id: "credit-1", amount: 200, remaining_amount: 50 }),
      ]);
      getPatientInvoices.mockResolvedValue([
        { id: "inv-9", invoice_number: "INV-00009", amount_paid: 150, balance: 0 },
      ]);
      reverseCustomerCreditApplication.mockResolvedValue({ id: "inv-9", balance: 150 });

      render(<CustomerCreditCard patientId="patient-1" patientName="Amina Otieno" currency="KES" />);

      await user.click(await screen.findByText("Reverse Application"));
      await screen.findByText("Reverse Customer Credit Application");

      await user.type(screen.getByLabelText("Amount"), "150");
      await user.type(screen.getByLabelText("Reason (required)"), "applied to the wrong invoice");

      const reverseButtons = screen.getAllByRole("button", { name: "Reverse Application" });
      await user.click(reverseButtons[reverseButtons.length - 1]);

      expect(reverseCustomerCreditApplication).toHaveBeenCalledWith(
        "credit-1",
        "inv-9",
        150,
        "applied to the wrong invoice"
      );
    });
  });
});
