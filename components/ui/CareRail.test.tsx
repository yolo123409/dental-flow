import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CareRail, { statusClass } from "./CareRail";

describe("CareRail", () => {
  it.each([
    ["Scheduled", "Scheduled", "care-rail-scheduled"],
    ["Ongoing", "In chair", "care-rail-ongoing"],
    ["Completed", "Completed", "care-rail-completed"],
    ["Cancelled", "Cancelled", "care-rail-cancelled"],
    ["Missed", "Missed", "care-rail-missed"],
  ] as const)("renders an accessible %s workflow cue", (status, label, railClass) => {
    render(<CareRail status={status}><p>Appointment content</p></CareRail>);

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("Appointment content").parentElement).toHaveClass(railClass);
  });

  it("uses dedicated status classes instead of action colors", () => {
    expect(statusClass("Ongoing")).toBe("status-ongoing");
    expect(statusClass("Cancelled")).toBe("status-cancelled");
  });
});
