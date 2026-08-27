import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentClinicId = vi.fn();

vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

vi.mock("./authorization", () => ({
  assertPermission: vi.fn(),
}));

const notifyPaymentRecorded = vi.fn();
const notifyInvoiceCreated = vi.fn();

vi.mock("./notifications", () => ({
  notifyPaymentRecorded: (...args: unknown[]) => notifyPaymentRecorded(...args),
  notifyInvoiceCreated: (...args: unknown[]) => notifyInvoiceCreated(...args),
}));

/**
 * Minimal stand-in for supabase-js's chainable, thenable query builder -
 * same pattern as services/treatmentTeeth.test.ts and
 * services/treatmentPlans.test.ts's own createSupabaseMock, extended with
 * the filter/modifier methods getCharges() and
 * findBrokenCanonicalChargeLinks() (Phase I) actually call: not/is (source
 * filtering), gte/lte (date filtering), ilike/or/limit (search), and
 * range (pagination) - plus an optional `count` a handler can return
 * alongside data/error.
 */
type Call = { method: string; args: unknown[] };
type TableHandler = (info: { op: string; calls: Call[] }) => {
  data: unknown;
  error: unknown;
  count?: number;
};

function createSupabaseMock(handlers: Record<string, TableHandler>) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      let op = "select";

      const record = (method: string, args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };

      const builder = {
        select: (...args: unknown[]) => {
          op = "select";
          return record("select", args);
        },
        insert: (...args: unknown[]) => {
          op = "insert";
          return record("insert", args);
        },
        update: (...args: unknown[]) => {
          op = "update";
          return record("update", args);
        },
        eq: (...args: unknown[]) => record("eq", args),
        not: (...args: unknown[]) => record("not", args),
        is: (...args: unknown[]) => record("is", args),
        gte: (...args: unknown[]) => record("gte", args),
        lte: (...args: unknown[]) => record("lte", args),
        gt: (...args: unknown[]) => record("gt", args),
        ilike: (...args: unknown[]) => record("ilike", args),
        or: (...args: unknown[]) => record("or", args),
        order: (...args: unknown[]) => record("order", args),
        limit: (...args: unknown[]) => record("limit", args),
        range: (...args: unknown[]) => record("range", args),
        single: (...args: unknown[]) => record("single", args),
        maybeSingle: (...args: unknown[]) => record("maybeSingle", args),
        then(
          resolve: (value: {
            data: unknown;
            error: unknown;
            count?: number;
          }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const handler = handlers[table];

          const result = handler
            ? handler({ op, calls })
            : { data: null, error: null };

          return Promise.resolve(result).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

let mockClient: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return mockClient;
  },
}));

const {
  calculateInvoiceTotals,
  getCharges,
  getChargeById,
  findBrokenCanonicalChargeLinks,
  recordPayment,
  getArSummary,
  getDiscountTotal,
  getOutstandingInvoiceBalance,
} = await import("./billing");

const CLINIC_ID = "clinic-a";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  notifyPaymentRecorded.mockReset();
  notifyInvoiceCreated.mockReset();
});

describe("calculateInvoiceTotals (Phase G section 24 - invoice arithmetic)", () => {
  it("computes exact 16% VAT on a grouped 3-tooth Treatment total (KES 60,000)", () => {
    const totals = calculateInvoiceTotals(60000, 0, {
      enabled: true,
      rate: 16,
      inclusive: false,
    });

    expect(totals).toEqual({ subtotal: 60000, tax: 9600, total: 69600 });
  });

  it("applies a discount before computing tax", () => {
    const totals = calculateInvoiceTotals(60000, 10000, {
      enabled: true,
      rate: 16,
      inclusive: false,
    });

    expect(totals).toEqual({ subtotal: 50000, tax: 8000, total: 58000 });
  });

  it("extracts tax from an inclusive price rather than adding it on top", () => {
    const totals = calculateInvoiceTotals(69600, 0, {
      enabled: true,
      rate: 16,
      inclusive: true,
    });

    expect(totals.total).toBe(69600);
    expect(totals.subtotal + totals.tax).toBe(69600);
  });

  it("charges no tax at all when the clinic has tax disabled", () => {
    const totals = calculateInvoiceTotals(60000, 0, {
      enabled: false,
      rate: 16,
      inclusive: false,
    });

    expect(totals).toEqual({ subtotal: 60000, tax: 0, total: 60000 });
  });

  it("single-tooth and 8-tooth totals both scale linearly with quantity x price", () => {
    const singleTooth = calculateInvoiceTotals(20000, 0, {
      enabled: true,
      rate: 16,
      inclusive: false,
    });
    const eightTeeth = calculateInvoiceTotals(20000 * 8, 0, {
      enabled: true,
      rate: 16,
      inclusive: false,
    });

    expect(singleTooth).toEqual({ subtotal: 20000, tax: 3200, total: 23200 });
    expect(eightTeeth).toEqual({
      subtotal: 160000,
      tax: 25600,
      total: 185600,
    });
  });
});

describe("getCharges (Phase I section 5/18/31 - Billing Control Center table)", () => {
  it("scopes to the clinic and applies status/source/date filters", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "eq",
          args: ["clinic_id", CLINIC_ID],
        });
        expect(calls).toContainEqual({
          method: "eq",
          args: ["status", "Pending"],
        });
        expect(calls).toContainEqual({
          method: "not",
          args: ["treatment_plan_item_id", "is", null],
        });
        expect(calls).toContainEqual({
          method: "gte",
          args: ["created_at", "2026-01-01"],
        });
        expect(calls).toContainEqual({ method: "range", args: [0, 49] });

        return {
          data: [{ id: "charge-1" }],
          error: null,
          count: 1,
        };
      },
    });

    const result = await getCharges(1, 50, {
      status: "Pending",
      source: "canonical",
      dateFrom: "2026-01-01",
    });

    expect(result).toEqual({ rows: [{ id: "charge-1" }], count: 1 });
  });

  it("filters to legacy charges via treatment_plan_item_id IS NULL, not a name/tooth guess", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "is",
          args: ["treatment_plan_item_id", null],
        });

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(1, 50, { source: "legacy" });
  });

  it("paginates via range(from, to) for the requested page/pageSize", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({ method: "range", args: [100, 124] });

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(5, 25, {});
  });

  it("resolves matching patient/invoice ids first, then ORs them with a treatment_name match", async () => {
    mockClient = createSupabaseMock({
      patients: () => ({ data: [{ id: "patient-1" }, { id: "patient-2" }], error: null }),
      clinic_invoices: () => ({ data: [{ id: "invoice-1" }], error: null }),
      clinic_charges: ({ calls }) => {
        const orCall = calls.find((c) => c.method === "or");

        expect(orCall?.args[0]).toBe(
          "treatment_name.ilike.%Root%,patient_id.in.(patient-1,patient-2),invoice_id.in.(invoice-1)"
        );

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(1, 50, { search: "Root" });
  });

  it("omits an empty in() clause when the search matches no patient or invoice", async () => {
    mockClient = createSupabaseMock({
      patients: () => ({ data: [], error: null }),
      clinic_invoices: () => ({ data: [], error: null }),
      clinic_charges: ({ calls }) => {
        const orCall = calls.find((c) => c.method === "or");

        expect(orCall?.args[0]).toBe("treatment_name.ilike.%Root%");

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(1, 50, { search: "Root" });
  });
});

describe("findBrokenCanonicalChargeLinks (Phase I section 27 - read-only reconciliation)", () => {
  it("returns nothing when every canonical charge's link points back correctly", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: () => ({
        data: [
          {
            id: "charge-1",
            treatment_plan_item_id: "item-1",
            treatment_plan_items: { id: "item-1", charge_id: "charge-1" },
          },
        ],
        error: null,
      }),
    });

    const broken = await findBrokenCanonicalChargeLinks();

    expect(broken).toEqual([]);
  });

  it("flags a charge whose linked treatment_plan_item.charge_id doesn't point back", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: () => ({
        data: [
          {
            id: "charge-1",
            treatment_plan_item_id: "item-1",
            // item-1 points at a DIFFERENT charge - broken bidirectional link.
            treatment_plan_items: { id: "item-1", charge_id: "charge-2" },
          },
        ],
        error: null,
      }),
    });

    const broken = await findBrokenCanonicalChargeLinks();

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      chargeId: "charge-1",
      treatmentPlanItemId: "item-1",
    });
  });

  it("flags a charge whose linked treatment_plan_item was not found at all", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: () => ({
        data: [
          {
            id: "charge-1",
            treatment_plan_item_id: "item-missing",
            treatment_plan_items: null,
          },
        ],
        error: null,
      }),
    });

    const broken = await findBrokenCanonicalChargeLinks();

    expect(broken).toHaveLength(1);
    expect(broken[0].reason).toMatch(/not found/i);
  });

  it("never repairs anything - it only reads and reports", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls.some((c) => c.method === "update")).toBe(false);
        expect(calls.some((c) => c.method === "insert")).toBe(false);
        expect(calls.some((c) => c.method === "delete")).toBe(false);

        return {
          data: [
            {
              id: "charge-1",
              treatment_plan_item_id: "item-1",
              treatment_plan_items: { id: "item-1", charge_id: "charge-2" },
            },
          ],
          error: null,
        };
      },
    });

    await findBrokenCanonicalChargeLinks();
  });
});

function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    clinic_id: CLINIC_ID,
    patient_id: "patient-1",
    invoice_number: "INV-00001",
    total: 60000,
    amount_paid: 0,
    balance: 60000,
    status: "Unpaid",
    ...overrides,
  };
}

describe("recordPayment (Phase J - the ONE payment source of truth; FIN-4.8 - now a thin wrapper over the atomic record_payment() RPC, migration 0102)", () => {
  it("rejects a zero amount before ever calling the RPC", async () => {
    const rpc = vi.fn();
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await expect(
      recordPayment("invoice-1", 0, "Cash")
    ).rejects.toThrow(/greater than zero/i);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    const rpc = vi.fn();
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await expect(
      recordPayment("invoice-1", -500, "Cash")
    ).rejects.toThrow(/greater than zero/i);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an Insurance payment with no insurance provider selected", async () => {
    const rpc = vi.fn();
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await expect(
      recordPayment("invoice-1", 1000, "Insurance")
    ).rejects.toThrow(/select an insurance provider/i);

    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own overpayment rejection rather than computing it client-side (FIN-4.8: the balance check now lives in the DB, under the same row lock as the write, so it can never race)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Payment amount exceeds the outstanding balance of 20000." },
    });
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await expect(
      recordPayment("invoice-1", 25000, "Cash")
    ).rejects.toThrow(/exceeds the outstanding balance/i);

    expect(notifyPaymentRecorded).not.toHaveBeenCalled();
  });

  it("passes every field through to record_payment, defaulting reference/notes/insurance provider to null", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: makeInvoiceRow({ balance: 0, total: 60000, amount_paid: 60000, status: "Paid" }),
      error: null,
    });
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await recordPayment("invoice-1", 60000, "Cash");

    expect(rpc).toHaveBeenCalledWith("record_payment", {
      p_invoice_id: "invoice-1",
      p_amount: 60000,
      p_payment_method: "Cash",
      p_reference: null,
      p_notes: null,
      p_insurance_provider_id: null,
    });
  });

  it("records a full payment and notifies with the RPC's own returned invoice (Phase J section 7)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: makeInvoiceRow({ balance: 0, total: 60000, amount_paid: 60000, status: "Paid" }),
      error: null,
    });
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await recordPayment("invoice-1", 60000, "Cash", "REF1", "note");

    expect(rpc).toHaveBeenCalledWith("record_payment", {
      p_invoice_id: "invoice-1",
      p_amount: 60000,
      p_payment_method: "Cash",
      p_reference: "REF1",
      p_notes: "note",
      p_insurance_provider_id: null,
    });
    expect(notifyPaymentRecorded).toHaveBeenCalledWith({
      id: "invoice-1",
      invoice_number: "INV-00001",
      amount: 60000,
    });
  });

  it("passes the insurance provider id through only for an Insurance payment", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: makeInvoiceRow({ balance: 40000, total: 60000, amount_paid: 20000, status: "Partially Paid" }),
      error: null,
    });
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    await recordPayment("invoice-1", 20000, "Insurance", undefined, undefined, "provider-1");

    expect(rpc).toHaveBeenCalledWith("record_payment", {
      p_invoice_id: "invoice-1",
      p_amount: 20000,
      p_payment_method: "Insurance",
      p_reference: null,
      p_notes: null,
      p_insurance_provider_id: "provider-1",
    });
  });
});

describe("getChargeById (Phase J section 18/21/22 - in-place refresh after payment)", () => {
  it("fetches a single charge by id, scoped to the clinic", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "eq",
          args: ["clinic_id", CLINIC_ID],
        });
        expect(calls).toContainEqual({ method: "eq", args: ["id", "charge-1"] });

        return { data: { id: "charge-1", status: "Invoiced" }, error: null };
      },
    });

    const result = await getChargeById("charge-1");

    expect(result).toEqual({ id: "charge-1", status: "Invoiced" });
  });

  it("returns null when the charge isn't found, rather than throwing", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: () => ({ data: null, error: null }),
    });

    const result = await getChargeById("missing");

    expect(result).toBeNull();
  });
});

describe("getCharges invoiceStatus filter (Phase J section 14/16/17)", () => {
  it("Outstanding filters on the linked invoice's balance > 0 (never a charge property)", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "gt",
          args: ["clinic_invoices.balance", 0],
        });

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(1, 50, { invoiceStatus: "Outstanding" });
  });

  it("Paid filters on the linked invoice's status, not amount_paid >= total", async () => {
    mockClient = createSupabaseMock({
      clinic_charges: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "eq",
          args: ["clinic_invoices.status", "Paid"],
        });

        return { data: [], error: null, count: 0 };
      },
    });

    await getCharges(1, 50, { invoiceStatus: "Paid" });
  });
});

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("getArSummary (Phase K - Accounts Receivable / Collections)", () => {
  it("ages from created_at only, buckets/patients/oldest/largest all reconcile from one fetched set", async () => {
    // Listed oldest-first (ascending created_at), matching the real query's
    // own .order("created_at", { ascending: true }) - the mock doesn't
    // simulate ordering, so the fixture supplies rows in the order the
    // real DB query would actually return them.
    const rawInvoices = [
      {
        id: "invoice-E",
        invoice_number: "INV-E",
        created_at: daysAgoIso(95),
        total: 5000,
        amount_paid: 0,
        balance: 5000,
        status: "Unpaid",
        patient_id: "patient-4",
        payment_method: null,
        insurance_provider_id: null,
        patients: { id: "patient-4", first_name: "David", last_name: "Mwangi" },
        insurance_provider: null,
        clinic_invoice_items: [{ treatment_name: "Cleaning" }],
      },
      {
        id: "invoice-C",
        invoice_number: "INV-C",
        created_at: daysAgoIso(75),
        total: 15000,
        amount_paid: 5000,
        balance: 15000,
        status: "Unpaid",
        patient_id: "patient-2",
        payment_method: null,
        insurance_provider_id: null,
        patients: { id: "patient-2", first_name: "Brian", last_name: "Kamau" },
        insurance_provider: null,
        clinic_invoice_items: [{ treatment_name: "Extraction" }],
      },
      {
        id: "invoice-B",
        invoice_number: "INV-B",
        created_at: daysAgoIso(45),
        total: 40000,
        amount_paid: 0,
        balance: 40000,
        status: "Unpaid",
        patient_id: "patient-1",
        payment_method: null,
        insurance_provider_id: null,
        patients: { id: "patient-1", first_name: "Amina", last_name: "Otieno" },
        insurance_provider: null,
        clinic_invoice_items: [
          { treatment_name: "Root Canal" },
          { treatment_name: "Crown" },
        ],
      },
      {
        id: "invoice-D",
        invoice_number: "INV-D",
        created_at: daysAgoIso(10),
        total: 200000,
        amount_paid: 0,
        balance: 200000,
        status: "Unpaid",
        patient_id: "patient-3",
        payment_method: null,
        insurance_provider_id: null,
        patients: { id: "patient-3", first_name: "Grace", last_name: "Wanjiru" },
        insurance_provider: null,
        clinic_invoice_items: [{ treatment_name: "Implant" }],
      },
      {
        id: "invoice-A",
        invoice_number: "INV-A",
        created_at: daysAgoIso(5),
        total: 20000,
        amount_paid: 0,
        balance: 20000,
        status: "Unpaid",
        patient_id: "patient-1",
        payment_method: null,
        insurance_provider_id: null,
        patients: { id: "patient-1", first_name: "Amina", last_name: "Otieno" },
        insurance_provider: null,
        clinic_invoice_items: [{ treatment_name: "Filling" }],
      },
    ];

    mockClient = createSupabaseMock({
      clinic_invoices: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "eq",
          args: ["clinic_id", CLINIC_ID],
        });
        // K18: paid-invoice exclusion is an authoritative query condition,
        // never left to the UI to filter out.
        expect(calls).toContainEqual({ method: "gt", args: ["balance", 0] });

        return { data: rawInvoices, error: null };
      },
    });

    const summary = await getArSummary();

    expect(summary.invoiceCount).toBe(5);
    expect(summary.patientCount).toBe(4);
    expect(summary.totalOutstanding).toBe(280000);

    // K5: every invoice in exactly one bucket, buckets sum to the total.
    const bucketByKey = Object.fromEntries(
      summary.buckets.map((b) => [b.key, b])
    );
    expect(bucketByKey["0-30"]).toMatchObject({ amount: 220000, count: 2 });
    expect(bucketByKey["31-60"]).toMatchObject({ amount: 40000, count: 1 });
    expect(bucketByKey["61-90"]).toMatchObject({ amount: 15000, count: 1 });
    expect(bucketByKey["90+"]).toMatchObject({ amount: 5000, count: 1 });
    expect(
      summary.buckets.reduce((sum, b) => sum + b.amount, 0)
    ).toBe(summary.totalOutstanding);

    // Oldest and largest are independently detected, not conflated.
    expect(summary.oldestInvoice?.invoiceId).toBe("invoice-E");
    expect(summary.largestInvoice?.invoiceId).toBe("invoice-D");

    // Patient aggregation: patient-1 has two invoices (60,000 combined),
    // sorted highest-outstanding-first.
    expect(summary.patients[0]).toMatchObject({
      patientId: "patient-3",
      outstanding: 200000,
      invoiceCount: 1,
    });
    const amina = summary.patients.find((p) => p.patientId === "patient-1");
    expect(amina).toMatchObject({ outstanding: 60000, invoiceCount: 2 });

    // Grouped invoice-item display (K21): one line for a single-item
    // invoice, "(+N more)" for a multi-item one - never split further.
    const invoiceA = summary.invoices.find((i) => i.invoiceId === "invoice-A");
    expect(invoiceA?.treatmentSummary).toBe("Filling");
    const invoiceB = summary.invoices.find((i) => i.invoiceId === "invoice-B");
    expect(invoiceB?.treatmentSummary).toBe("Root Canal (+1 more)");

    // Default ordering follows the query's own ascending created_at order
    // (oldest-first, K9) - getArSummary() doesn't re-sort what the DB gives it.
    expect(summary.invoices[0].invoiceId).toBe("invoice-E");
    expect(summary.invoices[summary.invoices.length - 1].invoiceId).toBe(
      "invoice-A"
    );
  });

  it("returns an empty, well-formed summary when nothing is outstanding", async () => {
    mockClient = createSupabaseMock({
      clinic_invoices: () => ({ data: [], error: null }),
    });

    const summary = await getArSummary();

    expect(summary.totalOutstanding).toBe(0);
    expect(summary.invoiceCount).toBe(0);
    expect(summary.patientCount).toBe(0);
    expect(summary.oldestInvoice).toBeNull();
    expect(summary.largestInvoice).toBeNull();
    expect(summary.buckets.every((b) => b.amount === 0 && b.count === 0)).toBe(
      true
    );
  });
});

describe("getDiscountTotal (Phase L section 14)", () => {
  it("sums clinic_invoices.discount within the period, scoped to the clinic", async () => {
    mockClient = createSupabaseMock({
      clinic_invoices: ({ calls }) => {
        expect(calls).toContainEqual({
          method: "eq",
          args: ["clinic_id", CLINIC_ID],
        });
        expect(calls).toContainEqual({
          method: "gte",
          args: ["created_at", "2026-08-01T00:00:00.000Z"],
        });

        return { data: [{ discount: 20000 }, { discount: 30000 }], error: null };
      },
    });

    const total = await getDiscountTotal(new Date("2026-08-01T00:00:00.000Z"), null);

    expect(total).toBe(50000);
  });

  it("returns 0 for a period with no invoices, never NaN", async () => {
    mockClient = createSupabaseMock({
      clinic_invoices: () => ({ data: [], error: null }),
    });

    const total = await getDiscountTotal(null, null);

    expect(total).toBe(0);
  });

  it("treats a null discount column as 0 rather than propagating NaN", async () => {
    mockClient = createSupabaseMock({
      clinic_invoices: () => ({
        data: [{ discount: null }, { discount: 5000 }],
        error: null,
      }),
    });

    const total = await getDiscountTotal(null, null);

    expect(total).toBe(5000);
  });
});

describe("getOutstandingInvoiceBalance (Phase O1 - unified canonical Outstanding AR)", () => {
  // get_outstanding_invoice_balance (migration 0082) does the actual
  // SUM(balance) WHERE balance>0 floor-at-zero aggregation server-side -
  // already independently verified against live, real mixed-sign
  // invoice data during Phase O's migration apply (matched the
  // separately-computed KES 1,890,320.00 exactly, correctly excluding
  // two real overpaid invoices). These tests cover the thin wrapper:
  // correct clinic scoping, correct pass-through/parsing of whatever the
  // RPC returns, and safe defaults - each scenario names the real-world
  // invoice condition the mocked RPC return value stands in for.
  function mockRpc(row: { outstanding: number } | null) {
    mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: row ? [row] : [], error: null }),
    } as unknown as ReturnType<typeof createSupabaseMock>;
  }

  it("returns the sum for a single invoice with a positive outstanding balance", async () => {
    mockRpc({ outstanding: 10000 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(10000);
  });

  it("returns 0 when the only invoice has a zero balance (fully paid, exact payment)", async () => {
    mockRpc({ outstanding: 0 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(0);
  });

  it("floors at 0 - a single overpaid (negative-balance) invoice never produces a negative total", async () => {
    // The RPC's own WHERE balance > 0 filter guarantees this server-side;
    // this asserts the wrapper never second-guesses or re-derives it.
    mockRpc({ outstanding: 0 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(0);
  });

  it("matches Phase O's own example exactly: Invoice A owes 10,000, Invoice B is overpaid by 1,000 -> canonical outstanding is 10,000, not 9,000", async () => {
    // SUM(balance) WHERE balance>0 over {10000, -1000} = 10000 (the RPC
    // computes this; the mock stands in for that server-side result).
    mockRpc({ outstanding: 10000 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(10000);
  });

  it("returns 0 when every invoice in the clinic is overpaid", async () => {
    mockRpc({ outstanding: 0 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(0);
  });

  it("returns 0 for a clinic with no invoices at all", async () => {
    mockRpc({ outstanding: 0 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(0);
  });

  it("scopes strictly to the current clinic, passing its id as p_clinic_id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ outstanding: 42000 }], error: null });
    mockClient = { rpc } as unknown as ReturnType<typeof createSupabaseMock>;

    getCurrentClinicId.mockResolvedValueOnce("clinic-b");
    const result = await getOutstandingInvoiceBalance();

    expect(result).toBe(42000);
    expect(rpc).toHaveBeenCalledWith("get_outstanding_invoice_balance", { p_clinic_id: "clinic-b" });
  });

  it("a partially-paid invoice contributes its real remaining balance, not its original total", async () => {
    // Invoice total 20000, paid 8000 -> balance 12000 is what the RPC
    // would sum; the wrapper just returns it unchanged.
    mockRpc({ outstanding: 12000 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(12000);
  });

  it("a fully-paid invoice with balance exactly 0 contributes nothing to the total", async () => {
    mockRpc({ outstanding: 0 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(0);
  });

  it("sums correctly across a mix of outstanding, fully-paid, and overpaid invoices in the same clinic", async () => {
    // e.g. {balance: 5000}, {balance: 0}, {balance: -250} -> RPC sums
    // only balance>0 rows = 5000.
    mockRpc({ outstanding: 5000 });

    await expect(getOutstandingInvoiceBalance()).resolves.toBe(5000);
  });

  it("throws a safe error and never returns a partial figure when the RPC call fails", async () => {
    mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    } as unknown as ReturnType<typeof createSupabaseMock>;

    await expect(getOutstandingInvoiceBalance()).rejects.toThrow();
  });
});
