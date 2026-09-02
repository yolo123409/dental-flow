import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const hasPermission = vi.fn((_permission: string) => false);

vi.mock("@/hooks/usePermissions", () => ({
  default: () => ({ role: "Dentist", hasPermission: (p: string) => hasPermission(p) }),
}));

const { default: PermissionGuard } = await import("./PermissionGuard");

beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => false);
});

describe("PermissionGuard bypass (full-app audit fix H17)", () => {
  it("shows Access Denied when the viewer lacks the permission and bypass is unset", () => {
    render(
      <PermissionGuard permission="users">
        <p>Protected content</p>
      </PermissionGuard>
    );

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("still renders the children when bypass is true, even without the permission", () => {
    render(
      <PermissionGuard permission="users" bypass>
        <p>Protected content</p>
      </PermissionGuard>
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
  });

  it("renders the children normally when the viewer does have the permission", () => {
    hasPermission.mockImplementation(() => true);

    render(
      <PermissionGuard permission="users">
        <p>Protected content</p>
      </PermissionGuard>
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});
