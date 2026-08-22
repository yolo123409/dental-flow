import { describe, expect, it, vi } from "vitest";

import { getSafeErrorMessage, toError } from "./logError";

describe("getSafeErrorMessage", () => {
  it("returns the message of a plain, hand-thrown Error (no `code` property) - a validation error the app itself wrote", () => {
    const error = new Error("Please upload a PNG, JPG, WEBP, or PDF file.");

    expect(getSafeErrorMessage(error, "Failed to upload file.")).toBe(
      "Please upload a PNG, JPG, WEBP, or PDF file."
    );
  });

  it("returns the fallback for an Error wrapping a raw Postgrest error (has a `code` property, even if its value is falsy)", () => {
    const pgError = { message: "duplicate key value violates unique constraint \"patients_email_key\"", code: "23505" };
    const wrapped = toError(pgError);

    expect(Object.prototype.hasOwnProperty.call(wrapped, "code")).toBe(true);
    expect(getSafeErrorMessage(wrapped, "Failed to save patient.")).toBe(
      "Failed to save patient."
    );
  });

  it("returns the fallback even when the wrapped Postgrest error's code is undefined - presence of the key matters, not its value", () => {
    const pgError = { message: "some internal detail" };
    const wrapped = toError(pgError);

    expect(Object.prototype.hasOwnProperty.call(wrapped, "code")).toBe(true);
    expect((wrapped as unknown as { code?: string }).code).toBeUndefined();
    expect(getSafeErrorMessage(wrapped, "Failed to load data.")).toBe(
      "Failed to load data."
    );
  });

  it("returns the fallback for a non-Error thrown value", () => {
    expect(getSafeErrorMessage("just a string", "Something went wrong.")).toBe(
      "Something went wrong."
    );

    expect(getSafeErrorMessage(null, "Something went wrong.")).toBe(
      "Something went wrong."
    );
  });

  it("returns an AuthorizationError-shaped message (a plain Error subclass with no `code` property, deliberately safe/user-facing)", () => {
    class AuthorizationError extends Error {
      constructor(message = "You do not have permission to perform this action.") {
        super(message);
        this.name = "AuthorizationError";
      }
    }

    expect(getSafeErrorMessage(new AuthorizationError(), "Failed.")).toBe(
      "You do not have permission to perform this action."
    );
  });

  it("still logs the real error via console.error even when the fallback is used", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const pgError = { message: "internal detail", code: "42501" };
    getSafeErrorMessage(toError(pgError), "Failed to load data.");

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
