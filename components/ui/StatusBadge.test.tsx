import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["Scheduled", "status-scheduled"],
    ["Ongoing", "status-ongoing"],
    ["Completed", "status-completed"],
    ["Cancelled", "status-cancelled"],
  ])("renders %s with its semantic token", (status, expectedClass) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(status)).toHaveClass(expectedClass);
  });
});
