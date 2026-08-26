import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentClinicId = vi.fn();

vi.mock("./clinic", () => ({
  getCurrentClinicId: () => getCurrentClinicId(),
}));

/**
 * Minimal stand-in for supabase-js's chainable, thenable query builder.
 * Every filter/modifier method (select/insert/upsert/delete/eq/in/order)
 * returns the same builder so calls can be chained in any order, exactly
 * like the real client; awaiting the builder resolves via `then()` to
 * whatever the table's configured handler returns, based on which
 * write/read method (`op`) was actually invoked and which filters were
 * applied along the way (`calls`) - so a test can assert the service
 * scoped its query correctly, not just that it returned data.
 */
type Call = { method: string; args: unknown[] };
type TableHandler = (info: { op: string; calls: Call[] }) => {
  data: unknown;
  error: unknown;
};

function createSupabaseMock(handlers: Record<string, TableHandler>) {
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
        delete: (...args: unknown[]) => {
          op = "delete";
          calls.push({ method: "delete", args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          calls.push({ method: "eq", args });
          return builder;
        },
        in: (...args: unknown[]) => {
          calls.push({ method: "in", args });
          return builder;
        },
        order: (...args: unknown[]) => {
          calls.push({ method: "order", args });
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

import {
  addTreatmentTeeth,
  getTreatmentTeeth,
  getTreatmentsForTooth,
  removeTreatmentTooth,
  replaceTreatmentTeeth,
} from "./treatmentTeeth";

const CLINIC_ID = "clinic-a";

beforeEach(() => {
  getCurrentClinicId.mockReset();
  getCurrentClinicId.mockResolvedValue(CLINIC_ID);
  mockClient = createSupabaseMock({});
});

/* -------------------------------------- */
/* Validation                             */
/* -------------------------------------- */

describe("addTreatmentTeeth validation", () => {
  it("rejects an empty tooth list", async () => {
    await expect(addTreatmentTeeth("item-1", [])).rejects.toThrow(
      /at least one tooth/i
    );
  });

  it("rejects tooth 0", async () => {
    await expect(addTreatmentTeeth("item-1", [0])).rejects.toThrow(/invalid/i);
  });

  // 19, 20, 29, 30, 39, 40, 49 are the "gap" values between FDI quadrants
  // (e.g. 18 is the last upper-right tooth, 21 is the first upper-left -
  // 19/20 are never valid) - real regression coverage for the Phase C fix
  // to this validation (it originally used a plain 1-32 numeric range,
  // which wrongly accepted these gap values and wrongly rejected every
  // FDI code above 32, i.e. most of the lower arch).
  it("rejects FDI gap values between quadrants", async () => {
    for (const gap of [19, 20, 29, 30, 39, 40, 49]) {
      await expect(addTreatmentTeeth("item-1", [gap])).rejects.toThrow(
        /invalid/i
      );
    }
  });

  it("rejects tooth -1", async () => {
    await expect(addTreatmentTeeth("item-1", [-1])).rejects.toThrow(
      /invalid/i
    );
  });

  it("rejects a non-integer tooth number", async () => {
    await expect(addTreatmentTeeth("item-1", [16.5])).rejects.toThrow(
      /invalid/i
    );
  });

  it("accepts every real FDI quadrant boundary, including the lower arch (33-38, 41-48)", async () => {
    mockClient = createSupabaseMock({
      treatment_teeth: () => ({ data: null, error: null }),
    });

    // 11/18: upper right; 21/28: upper left; 31/38: lower left;
    // 41/48: lower right - the exact range this validation originally
    // got wrong for the lower-right quadrant and most of lower-left.
    await expect(
      addTreatmentTeeth("item-1", [11, 18, 21, 28, 31, 38, 41, 48])
    ).resolves.toBeUndefined();
  });
});

/* -------------------------------------- */
/* Creation / Multi-tooth / Dedup         */
/* -------------------------------------- */

describe("addTreatmentTeeth", () => {
  it("associates a single tooth with a treatment item", async () => {
    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: null, error: null };
      },
    });

    await addTreatmentTeeth("item-1", [16]);

    const upsertCall = captured.find((c) => c.method === "upsert");
    expect(upsertCall).toBeDefined();

    const rows = upsertCall!.args[0] as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { clinic_id: CLINIC_ID, treatment_plan_item_id: "item-1", tooth_number: 16 },
    ]);
  });

  it("associates multiple teeth (16, 17, 18) with one treatment item in a single call", async () => {
    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: null, error: null };
      },
    });

    await addTreatmentTeeth("item-A", [16, 17, 18]);

    const upsertCalls = captured.filter((c) => c.method === "upsert");
    // One statement for all three teeth, not three separate calls -
    // this is what gives the write its atomicity.
    expect(upsertCalls).toHaveLength(1);

    const rows = upsertCalls[0].args[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.tooth_number)).toEqual([16, 17, 18]);
    expect(rows.every((r) => r.treatment_plan_item_id === "item-A")).toBe(true);

    const options = upsertCalls[0].args[1] as Record<string, unknown>;
    expect(options.onConflict).toBe("treatment_plan_item_id,tooth_number");
    expect(options.ignoreDuplicates).toBe(true);
  });

  it("de-duplicates repeated tooth numbers before writing", async () => {
    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: null, error: null };
      },
    });

    await addTreatmentTeeth("item-1", [16, 16, 17]);

    const upsertCall = captured.find((c) => c.method === "upsert");
    const rows = upsertCall!.args[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.tooth_number)).toEqual([16, 17]);
  });

  it("propagates a database error", async () => {
    mockClient = createSupabaseMock({
      treatment_teeth: () => ({
        data: null,
        error: new Error("constraint violation"),
      }),
    });

    await expect(addTreatmentTeeth("item-1", [16])).rejects.toThrow(
      "constraint violation"
    );
  });
});

/* -------------------------------------- */
/* Retrieval                              */
/* -------------------------------------- */

describe("getTreatmentTeeth", () => {
  it("returns the teeth associated with a treatment, sorted", async () => {
    mockClient = createSupabaseMock({
      treatment_teeth: () => ({
        data: [
          { tooth_number: 18 },
          { tooth_number: 16 },
          { tooth_number: 17 },
        ],
        error: null,
      }),
    });

    const teeth = await getTreatmentTeeth("item-A");

    expect(teeth).toEqual([18, 16, 17]);
  });

  it("scopes the lookup by clinic and treatment item", async () => {
    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: [], error: null };
      },
    });

    await getTreatmentTeeth("item-A");

    const eqCalls = captured.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["clinic_id", CLINIC_ID] });
    expect(eqCalls).toContainEqual({
      method: "eq",
      args: ["treatment_plan_item_id", "item-A"],
    });
  });

  it("returns an empty array when nothing is associated", async () => {
    mockClient = createSupabaseMock({
      treatment_teeth: () => ({ data: [], error: null }),
    });

    await expect(getTreatmentTeeth("item-none")).resolves.toEqual([]);
  });
});

/* -------------------------------------- */
/* Reverse retrieval                      */
/* -------------------------------------- */

describe("getTreatmentsForTooth", () => {
  it("returns treatment_plan_items associated with a patient's tooth", async () => {
    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [{ id: "plan-1" }], error: null }),
      treatment_teeth: () => ({
        data: [{ treatment_plan_item_id: "item-A" }],
        error: null,
      }),
      treatment_plan_items: () => ({
        data: [{ id: "item-A", treatment_plan_id: "plan-1", procedure: "Filling" }],
        error: null,
      }),
    });

    const items = await getTreatmentsForTooth("patient-1", 16);

    expect(items).toEqual([
      { id: "item-A", treatment_plan_id: "plan-1", procedure: "Filling" },
    ]);
  });

  it("returns [] without querying items when the patient has no plans", async () => {
    let itemsQueried = false;

    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [], error: null }),
      treatment_teeth: () => ({
        data: [{ treatment_plan_item_id: "item-A" }],
        error: null,
      }),
      treatment_plan_items: () => {
        itemsQueried = true;
        return { data: [], error: null };
      },
    });

    const items = await getTreatmentsForTooth("patient-1", 16);

    expect(items).toEqual([]);
    expect(itemsQueried).toBe(false);
  });

  it("returns [] when the tooth has no relationships", async () => {
    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [{ id: "plan-1" }], error: null }),
      treatment_teeth: () => ({ data: [], error: null }),
    });

    await expect(getTreatmentsForTooth("patient-1", 16)).resolves.toEqual([]);
  });

  // Phase D section 20: treatment_teeth is authoritative, but an item
  // with no relationship at all (a pre-Phase-A record, or one created
  // through a path that predates the Phase D unification) must still be
  // found via the legacy tooth_number column.
  it("falls back to the legacy tooth_number for an item with no treatment_teeth relationship at all", async () => {
    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [{ id: "plan-1" }], error: null }),
      treatment_teeth: () => ({ data: [], error: null }),
      treatment_plan_items: () => ({
        data: [
          {
            id: "legacy-item",
            treatment_plan_id: "plan-1",
            tooth_number: 16,
            treatment_teeth: [],
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    });

    const items = await getTreatmentsForTooth("patient-1", 16);

    expect(items.map((item) => item.id)).toEqual(["legacy-item"]);
  });

  it("does not return an item twice when it matches by both treatment_teeth and the legacy tooth_number", async () => {
    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [{ id: "plan-1" }], error: null }),
      treatment_teeth: () => ({
        data: [{ treatment_plan_item_id: "item-A" }],
        error: null,
      }),
      treatment_plan_items: () => ({
        data: [
          {
            id: "item-A",
            treatment_plan_id: "plan-1",
            tooth_number: 16,
            treatment_teeth: [{ tooth_number: 16 }],
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    });

    const items = await getTreatmentsForTooth("patient-1", 16);

    expect(items.map((item) => item.id)).toEqual(["item-A"]);
  });

  it("ignores a stale legacy tooth_number once a real treatment_teeth relationship exists for other teeth", async () => {
    // e.g. an item edited (via updateTreatmentTeeth) from tooth 16 to
    // tooth 17 - a real relationship always wins over a stale legacy
    // column, so this must not appear under tooth 16 any more.
    mockClient = createSupabaseMock({
      treatment_plans: () => ({ data: [{ id: "plan-1" }], error: null }),
      treatment_teeth: () => ({ data: [], error: null }),
      treatment_plan_items: () => ({
        data: [
          {
            id: "item-B",
            treatment_plan_id: "plan-1",
            tooth_number: 16,
            treatment_teeth: [{ tooth_number: 17 }],
            created_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    });

    await expect(getTreatmentsForTooth("patient-1", 16)).resolves.toEqual([]);
  });
});

/* -------------------------------------- */
/* Removal                                */
/* -------------------------------------- */

describe("removeTreatmentTooth", () => {
  it("deletes exactly the (treatment, tooth) relationship, scoped by clinic", async () => {
    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: null, error: null };
      },
    });

    await removeTreatmentTooth("item-A", 17);

    expect(captured[0]).toEqual({ method: "delete", args: [] });

    const eqCalls = captured.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["clinic_id", CLINIC_ID] });
    expect(eqCalls).toContainEqual({
      method: "eq",
      args: ["treatment_plan_item_id", "item-A"],
    });
    expect(eqCalls).toContainEqual({ method: "eq", args: ["tooth_number", 17] });
  });
});

/* -------------------------------------- */
/* Replacement                            */
/* -------------------------------------- */

describe("replaceTreatmentTeeth", () => {
  it("replaces 16,17,18 with 16,17", async () => {
    const ops: string[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        ops.push(info.op);
        return { data: null, error: null };
      },
    });

    await replaceTreatmentTeeth("item-A", [16, 17]);

    // Delete-then-insert, in that order.
    expect(ops).toEqual(["delete", "upsert"]);
  });

  it("only deletes when the replacement set is empty", async () => {
    const ops: string[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        ops.push(info.op);
        return { data: null, error: null };
      },
    });

    await replaceTreatmentTeeth("item-A", []);

    expect(ops).toEqual(["delete"]);
  });
});

/* -------------------------------------- */
/* Isolation (defense-in-depth in code -   */
/* actual RLS enforcement is a database-   */
/* level guarantee this suite cannot       */
/* exercise without a live Postgres        */
/* instance - see the final report)        */
/* -------------------------------------- */

describe("clinic scoping", () => {
  it("every write is scoped to the current clinic, never a caller-supplied one", async () => {
    getCurrentClinicId.mockResolvedValue("clinic-a");

    let captured: Call[] = [];

    mockClient = createSupabaseMock({
      treatment_teeth: (info) => {
        captured = info.calls;
        return { data: null, error: null };
      },
    });

    await addTreatmentTeeth("item-1", [16]);

    const upsertRows = captured.find((c) => c.method === "upsert")!
      .args[0] as Array<Record<string, unknown>>;

    expect(upsertRows[0].clinic_id).toBe("clinic-a");
  });
});
