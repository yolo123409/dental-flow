import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentClinicId = vi.fn();

vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

type Call = { method: string; args: unknown[] };
type TableHandler = (info: { op: string; calls: Call[] }) => {
  data: unknown;
  error: unknown;
};

function createSupabaseMock(handlers: Record<string, TableHandler> = {}) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      let op = "select";

      const builder = {
        select: (...args: unknown[]) => {
          op = "select";
          calls.push({ method: "select", args });
          return builder;
        },
        upsert: (...args: unknown[]) => {
          op = "upsert";
          calls.push({ method: "upsert", args });
          return builder;
        },
        insert: (...args: unknown[]) => {
          op = "insert";
          calls.push({ method: "insert", args });
          return builder;
        },
        update: (...args: unknown[]) => {
          op = "update";
          calls.push({ method: "update", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ method: "eq", args });
          return builder;
        },
        maybeSingle: (...args: unknown[]) => {
          calls.push({ method: "maybeSingle", args });
          return builder;
        },
        then(
          resolve: (value: { data: unknown; error: unknown }) => unknown,
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

const { saveTooth } = await import("./patientTeeth");

const CLINIC_ID = "clinic-a";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  mockClient = createSupabaseMock();
});

function makeTooth(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    patient_id: "patient-1",
    tooth_number: 16,
    condition: "Healthy",
    diagnosis: "",
    treatment: "Root Canal",
    treatment_status: "Planned",
    materials: "",
    estimated_cost: 20000,
    notes: "",
    ...overrides,
  } as never;
}

describe("saveTooth - skipLegacyCharge (Phase H)", () => {
  it("still creates a legacy Pending charge by default (skipLegacyCharge omitted)", async () => {
    let chargeInsertCalled = false;

    mockClient = createSupabaseMock({
      patient_teeth: () => ({ data: null, error: null }),
      patient_tooth_history: () => ({ data: null, error: null }),
      clinic_charges: (info) => {
        if (info.op === "select") return { data: null, error: null };
        chargeInsertCalled = true;
        return { data: null, error: null };
      },
    });

    await saveTooth(makeTooth());

    expect(chargeInsertCalled).toBe(true);
  });

  it("skips legacy charge creation entirely when skipLegacyCharge is true", async () => {
    let chargesTableTouched = false;

    mockClient = createSupabaseMock({
      patient_teeth: () => ({ data: null, error: null }),
      patient_tooth_history: () => ({ data: null, error: null }),
      clinic_charges: () => {
        chargesTableTouched = true;
        return { data: null, error: null };
      },
    });

    await saveTooth(makeTooth(), { skipLegacyCharge: true });

    expect(chargesTableTouched).toBe(false);
  });

  it("still saves clinical fields (patient_teeth + history) even when skipping the legacy charge", async () => {
    let upsertedRow: Record<string, unknown> | null = null;
    let historyInserted = false;

    mockClient = createSupabaseMock({
      patient_teeth: (info) => {
        const upsertCall = info.calls.find((c) => c.method === "upsert");
        upsertedRow = upsertCall?.args[0] as Record<string, unknown>;
        return { data: null, error: null };
      },
      patient_tooth_history: () => {
        historyInserted = true;
        return { data: null, error: null };
      },
    });

    await saveTooth(
      makeTooth({ condition: "Caries", notes: "new note" }),
      { skipLegacyCharge: true }
    );

    expect(upsertedRow).toMatchObject({
      condition: "Caries",
      notes: "new note",
      // treatment/estimated_cost still pass through into the historical
      // record - skipLegacyCharge only suppresses the billing side
      // effect, never the clinical upsert/history itself.
      treatment: "Root Canal",
      estimated_cost: 20000,
    });
    expect(historyInserted).toBe(true);
  });
});
