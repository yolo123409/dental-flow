import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const getChargeById = vi.fn();
const recordPayment = vi.fn();

vi.mock("@/services/billing", () => ({
  getChargeById: (...args: unknown[]) => getChargeById(...args),
  recordPayment: (...args: unknown[]) => recordPayment(...args),
}));

vi.mock("@/services/insurance", () => ({
  getClinicInsuranceProviders: vi.fn().mockResolvedValue([]),
}));

import ChargeDetailModal from "./ChargeDetailModal";
import { ClinicChargeWithDetails } from "@/services/billing";

function makeCharge(
  overrides: Partial<ClinicChargeWithDetails> = {}
): ClinicChargeWithDetails {
  return {
    id: "charge-1",
    clinic_id: "clinic-1",
    patient_id: "patient-1",
    tooth_number: 16,
    treatment_name: "Root Canal",
    amount: 20000,
    status: "Invoiced",
    invoice_id: "invoice-1",
    treatment_plan_item_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    patients: { id: "patient-1", first_name: "Jane", last_name: "Doe" },
    clinic_invoices: {
      id: "invoice-1",
      invoice_number: "INV-00042",
      status: "Partially Paid",
      total: 60000,
      amount_paid: 15000,
      balance: 45000,
      payment_method: null,
      insurance_provider_id: null,
      insurance_provider: null,
    },
    treatment_plan_items: null,
    ...overrides,
  } as ClinicChargeWithDetails;
}

describe("ChargeDetailModal - payment section (Phase J section 3)", () => {
  it("shows Invoice Status/Amount Paid/Balance and a Record Payment button when a balance remains", () => {
    render(
      <ChargeDetailModal
        charge={makeCharge()}
        currency="KES"
        onClose={vi.fn()}
        onPaymentRecorded={vi.fn()}
      />
    );

    expect(screen.getByText("Partially Paid")).toBeInTheDocument();
    expect(screen.getByText(/KES\s*15,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*45,000/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record Payment" })
    ).toBeInTheDocument();
  });

  it("shows 'Paid' instead of a Record Payment button once the balance is fully paid", () => {
    render(
      <ChargeDetailModal
        charge={makeCharge({
          clinic_invoices: {
            id: "invoice-1",
            invoice_number: "INV-00042",
            status: "Paid",
            total: 60000,
            amount_paid: 60000,
            balance: 0,
            payment_method: null,
            insurance_provider_id: null,
            insurance_provider: null,
          },
        })}
        currency="KES"
        onClose={vi.fn()}
        onPaymentRecorded={vi.fn()}
      />
    );

    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Record Payment" })
    ).not.toBeInTheDocument();
  });

  it("shows 'ready to bill' messaging and no payment section for a charge with no invoice yet", () => {
    render(
      <ChargeDetailModal
        charge={makeCharge({
          status: "Pending",
          invoice_id: null,
          clinic_invoices: null,
        })}
        currency="KES"
        onClose={vi.fn()}
        onPaymentRecorded={vi.fn()}
      />
    );

    expect(
      screen.getByText(/not yet invoiced - ready to bill/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record Payment" })
    ).not.toBeInTheDocument();
  });

  it("allows recording a payment against a legacy (no Treatment Plan) invoiced charge (Phase J section 28)", () => {
    render(
      <ChargeDetailModal
        charge={makeCharge({ treatment_plan_item_id: null })}
        currency="KES"
        onClose={vi.fn()}
        onPaymentRecorded={vi.fn()}
      />
    );

    expect(screen.getByText("Legacy Tooth Charge")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record Payment" })
    ).toBeInTheDocument();
  });
});
