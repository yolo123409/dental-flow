import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpc = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return { rpc: (...args: unknown[]) => rpc(...args) };
  },
}));

const { updateOwnProfile } = await import("./users");

beforeEach(() => {
  rpc.mockClear();
  rpcResult = { data: [], error: null };
});

describe("updateOwnProfile (full-app audit fix H17)", () => {
  it("calls update_own_profile with the given name/phone, not a client-supplied id", async () => {
    rpcResult = {
      data: [{ id: "cu-1", full_name: "Jane Doe", phone: "555-1234" }],
      error: null,
    };

    const result = await updateOwnProfile("Jane Doe", "555-1234");

    expect(rpc).toHaveBeenCalledWith("update_own_profile", {
      p_full_name: "Jane Doe",
      p_phone: "555-1234",
    });
    expect(result).toEqual([
      { id: "cu-1", full_name: "Jane Doe", phone: "555-1234" },
    ]);
  });

  it("throws a safe error rather than returning partial data when the RPC fails", async () => {
    rpcResult = {
      data: null,
      error: { message: "Full name cannot be empty.", code: "P0001" },
    };

    await expect(updateOwnProfile("", "555-1234")).rejects.toThrow(
      /Full name cannot be empty/i
    );
  });

  it("returns an empty array rather than throwing when data comes back null with no error", async () => {
    rpcResult = { data: null, error: null };

    await expect(updateOwnProfile("Jane Doe", "")).resolves.toEqual([]);
  });
});
