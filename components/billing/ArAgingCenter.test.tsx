import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const getArSummary = vi.fn();
const recordPayment = vi.fn();

vi.mock("@/services/billing", () => ({
  getArSummary: (...args: unknown[]) => getArSummary(...args),
  recordPayment: (...args: unknown[]) => recordPayment(...args),
}));

vi.mock("@/services/insurance", () => ({
  getClinicInsuranceProviders: vi.fn().mockResolvedValue([]),
}));

import ArAgingCenter from "./ArAgingCenter";
import { ArSummary } from "@/services/billing";

function makeSummary(overrides: Partial<ArSummary> = {}): ArSummary {
  const invoiceOld = {
    invoiceId: "invoice-old",
    invoiceNumber: "INV-00010",
    invoiceDate: "2025-01-01T00:00:00.000Z",
    patientId: "patient-1",
    patientName: "Amina Otieno",
    treatmentSummary: "Root Canal (+1 more)",
    total: 60000,
    amountPaid: 0,
    balance: 60000,
    status: "Unpaid",
    ageDays: 95,
    bucket: "90+" as const,
    paymentMethod: null,
    insuranceProviderId: null,
    insuranceProviderName: null,
  };

  const invoiceRecent = {
    invoiceId: "invoice-recent",
    invoiceNumber: "INV-00020",
    invoiceDate: "2026-08-01T00:00:00.000Z",
    patientId: "patient-1",
    patientName: "Amina Otieno",
    treatmentSummary: "Filling",
    total: 20000,
    amountPaid: 5000,
    balance: 15000,
    status: "Partially Paid",
    ageDays: 5,
    bucket: "0-30" as const,
    paymentMethod: null,
    insuranceProviderId: null,
    insuranceProviderName: null,
  };

  return {
    totalOutstanding: 75000,
    invoiceCount: 2,
    patientCount: 1,
    buckets: [
      { key: "0-30", label: "0–30 Days", amount: 15000, count: 1 },
      { key: "31-60", label: "31–60 Days", amount: 0, count: 0 },
      { key: "61-90", label: "61–90 Days", amount: 0, count: 0 },
      { key: "90+", label: "90+ Days", amount: 60000, count: 1 },
    ],
    oldestInvoice: invoiceOld,
    largestInvoice: invoiceOld,
    invoices: [invoiceOld, invoiceRecent],
    patients: [
      {
        patientId: "patient-1",
        patientName: "Amina Otieno",
        outstanding: 75000,
        invoiceCount: 2,
        oldestAgeDays: 95,
      },
    ],
    ...overrides,
  };
}

describe("ArAgingCenter (Phase K - AR / Collections Center)", () => {
  it("shows the AR summary, aging buckets, and outstanding invoice table", async () => {
    getArSummary.mockResolvedValue(makeSummary());

    render(<ArAgingCenter currency="KES" onPaymentRecorded={vi.fn()} />);

    expect(await screen.findByText("Total Outstanding")).toBeInTheDocument();
    // "KES 75,000" is both the Total Outstanding figure and patient-1's
    // Needs Attention total (same underlying number) - assert presence,
    // not uniqueness.
    expect(screen.getAllByText(/KES\s*75,000/).length).toBeGreaterThan(0);

    // Aging buckets (labels appear both in the Aging visualization and the
    // bucket-filter pills below it).
    expect(screen.getAllByText(/0–30 Days/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/90\+ Days/).length).toBeGreaterThan(0);

    // Outstanding invoices table. INV-00010 is also the Oldest
    // Outstanding/Largest Balance spotlight subtitle in this fixture, so
    // it legitimately appears more than once.
    expect(screen.getAllByText("INV-00010").length).toBeGreaterThan(0);
    expect(screen.getByText("INV-00020")).toBeInTheDocument();
    expect(screen.getAllByText("Amina Otieno").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Record Payment" }).length
    ).toBe(2);
  });

  it("surfaces a patient with multiple outstanding invoices under Needs Attention", async () => {
    getArSummary.mockResolvedValue(makeSummary());

    render(<ArAgingCenter currency="KES" onPaymentRecorded={vi.fn()} />);

    expect(await screen.findByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText(/2 invoices · oldest 95 days/)).toBeInTheDocument();
  });

  it("filters the table by aging bucket", async () => {
    getArSummary.mockResolvedValue(makeSummary());

    render(<ArAgingCenter currency="KES" onPaymentRecorded={vi.fn()} />);

    await screen.findByText("INV-00020");

    fireEvent.click(screen.getByRole("button", { name: "90+ Days" }));

    expect(screen.getAllByText("INV-00010").length).toBeGreaterThan(0);
    expect(screen.queryByText("INV-00020")).not.toBeInTheDocument();
  });

  it("filters the table by search term (patient name)", async () => {
    getArSummary.mockResolvedValue(
      makeSummary({
        patients: [],
        invoices: [
          {
            invoiceId: "invoice-x",
            invoiceNumber: "INV-X",
            invoiceDate: "2026-08-01T00:00:00.000Z",
            patientId: "patient-2",
            patientName: "Brian Kamau",
            treatmentSummary: "Cleaning",
            total: 5000,
            amountPaid: 0,
            balance: 5000,
            status: "Unpaid",
            ageDays: 2,
            bucket: "0-30",
            paymentMethod: null,
            insuranceProviderId: null,
            insuranceProviderName: null,
          },
          {
            invoiceId: "invoice-y",
            invoiceNumber: "INV-Y",
            invoiceDate: "2026-08-01T00:00:00.000Z",
            patientId: "patient-3",
            patientName: "Carol Njeri",
            treatmentSummary: "Extraction",
            total: 8000,
            amountPaid: 0,
            balance: 8000,
            status: "Unpaid",
            ageDays: 2,
            bucket: "0-30",
            paymentMethod: null,
            insuranceProviderId: null,
            insuranceProviderName: null,
          },
        ],
      })
    );

    render(<ArAgingCenter currency="KES" onPaymentRecorded={vi.fn()} />);

    await screen.findByText("INV-X");

    fireEvent.change(
      screen.getByPlaceholderText("Search patient or invoice #..."),
      { target: { value: "Carol" } }
    );

    expect(screen.queryByText("INV-X")).not.toBeInTheDocument();
    expect(screen.getByText("INV-Y")).toBeInTheDocument();
  });

  it("shows a clean empty state when nothing is outstanding (K18: paid invoices never appear)", async () => {
    getArSummary.mockResolvedValue(
      makeSummary({
        totalOutstanding: 0,
        invoiceCount: 0,
        patientCount: 0,
        buckets: [
          { key: "0-30", label: "0–30 Days", amount: 0, count: 0 },
          { key: "31-60", label: "31–60 Days", amount: 0, count: 0 },
          { key: "61-90", label: "61–90 Days", amount: 0, count: 0 },
          { key: "90+", label: "90+ Days", amount: 0, count: 0 },
        ],
        oldestInvoice: null,
        largestInvoice: null,
        invoices: [],
        patients: [],
      })
    );

    render(<ArAgingCenter currency="KES" onPaymentRecorded={vi.fn()} />);

    expect(
      await screen.findByText("Nothing outstanding right now")
    ).toBeInTheDocument();
  });
});
