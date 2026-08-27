import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const getPatientCredits = vi.fn();
const getPatientInvoices = vi.fn();

vi.mock("@/services/customerCredits", () => ({
  getPatientCredits: (...args: unknown[]) => getPatientCredits(...args),
}));

vi.mock("@/services/billing", () => ({
  getPatientInvoices: (...args: unknown[]) => getPatientInvoices(...args),
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
});
