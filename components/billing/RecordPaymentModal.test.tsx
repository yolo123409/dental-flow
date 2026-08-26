import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const recordPayment = vi.fn();

vi.mock("@/services/billing", () => ({
  recordPayment: (...args: unknown[]) => recordPayment(...args),
}));

vi.mock("@/services/insurance", () => ({
  getClinicInsuranceProviders: vi.fn().mockResolvedValue([]),
}));

import RecordPaymentModal from "./RecordPaymentModal";

const DEFAULT_PROPS = {
  invoiceId: "invoice-1",
  invoiceNumber: "INV-00042",
  patientName: "Jane Doe",
  currency: "KES",
  total: 60000,
  amountPaid: 20000,
  balance: 40000,
  invoicePaymentMethod: null,
  invoiceInsuranceProviderId: null,
  invoiceInsuranceProviderName: null,
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe("RecordPaymentModal (Phase J section 4/5/19/20)", () => {
  it("shows the invoice/patient context before submission", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    expect(screen.getByText("INV-00042")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText(/KES\s*60,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*20,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*40,000/)).toBeInTheDocument();
  });

  it("disables Record Payment until a positive amount is entered", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    expect(
      screen.getByRole("button", { name: "Record Payment" })
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Payment Amount"), {
      target: { value: "10000" },
    });

    expect(
      screen.getByRole("button", { name: "Record Payment" })
    ).not.toBeDisabled();
  });

  it("Pay Full Balance fills the amount field with the exact outstanding balance", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByText("Pay Full Balance"));

    expect(screen.getByLabelText("Payment Amount")).toHaveValue(40000);
  });

  it("disables Record Payment and shows an inline error when the amount exceeds the balance (Phase J section 5)", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    fireEvent.change(screen.getByLabelText("Payment Amount"), {
      target: { value: "50000" },
    });

    expect(
      screen.getByRole("button", { name: "Record Payment" })
    ).toBeDisabled();
    expect(
      screen.getByText(/exceeds the outstanding balance/i)
    ).toBeInTheDocument();
  });

  it("shows a live 'remaining after this payment' summary for a partial amount (Phase J section 20/22)", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    fireEvent.change(screen.getByLabelText("Payment Amount"), {
      target: { value: "10000" },
    });

    expect(
      screen.getByText("Remaining after this payment")
    ).toBeInTheDocument();
    expect(screen.getByText(/KES\s*30,000/)).toBeInTheDocument();
    expect(
      screen.getByText(/leave the invoice Partially Paid/i)
    ).toBeInTheDocument();
  });

  it("shows 'fully pay off' messaging when the full balance is entered", () => {
    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByText("Pay Full Balance"));

    expect(
      screen.getByText(/fully pay off the invoice/i)
    ).toBeInTheDocument();
  });

  it("calls recordPayment with the entered amount/method/reference/notes on submit", async () => {
    recordPayment.mockResolvedValue(undefined);

    render(<RecordPaymentModal {...DEFAULT_PROPS} />);

    fireEvent.change(screen.getByLabelText("Payment Amount"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. M-Pesa code, receipt #"), {
      target: { value: "REF-9" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await vi.waitFor(() => {
      expect(recordPayment).toHaveBeenCalledWith(
        "invoice-1",
        15000,
        "Cash",
        "REF-9",
        "",
        null
      );
    });
  });

  it("returns null and renders nothing when closed", () => {
    const { container } = render(
      <RecordPaymentModal {...DEFAULT_PROPS} open={false} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
