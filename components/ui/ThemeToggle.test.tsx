import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import ThemeToggle from "./ThemeToggle";

describe("ThemeToggle", () => {
  it("uses the saved theme and persists a user change", async () => {
    localStorage.setItem("dental-flow-theme", "dark");
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("dental-flow-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  });

  it("falls back to the system preference when no choice is saved", () => {
    window.matchMedia = (() => ({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
