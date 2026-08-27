import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const switchActiveBranch = vi.fn();

vi.mock("@/services/organizations", () => ({
  switchActiveBranch: (...args: unknown[]) => switchActiveBranch(...args),
}));

const useOrganization = vi.fn();

vi.mock("@/hooks/useOrganization", () => ({
  default: () => useOrganization(),
}));

import BranchSwitcher from "./BranchSwitcher";
import { OrganizationBranch, OrganizationUser } from "@/types/organization";

function makeBranch(id: string, name: string): OrganizationBranch {
  return {
    id,
    name,
    organization_id: "org-1",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeOrgUser(
  overrides: Partial<OrganizationUser> = {}
): OrganizationUser {
  return {
    id: "org-user-1",
    organization_id: "org-1",
    auth_user_id: "auth-1",
    role: "CEO",
    active_clinic_id: "branch-1",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const parklands = makeBranch("branch-1", "parklands");
const westlands = makeBranch("branch-2", "westlands");

function mockOrgState(overrides: Partial<ReturnType<typeof useOrganization>> = {}) {
  const reload = vi.fn().mockResolvedValue(undefined);

  useOrganization.mockReturnValue({
    organizationUser: makeOrgUser(),
    myBranches: [parklands, westlands],
    activeBranch: parklands,
    isCeo: true,
    loading: false,
    reload,
    ...overrides,
  });

  return reload;
}

// BranchSwitcher navigates via a hard `window.location.href` assignment
// (not next/navigation's router) so that every already-mounted
// clinic-scoped page and AuthContext's own cached profile genuinely
// remount with the new branch - see the comment on that line in the
// component. jsdom doesn't implement real navigation, so location is
// replaced with a plain writable stub to observe the assignment.
let locationStub: { href: string };

beforeEach(() => {
  vi.clearAllMocks();

  locationStub = { href: "" };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: locationStub,
  });
});

describe("BranchSwitcher", () => {
  it("renders nothing for a user with no organization membership (independent clinic)", () => {
    useOrganization.mockReturnValue({
      organizationUser: null,
      myBranches: [],
      activeBranch: null,
      isCeo: false,
      loading: false,
      reload: vi.fn(),
    });

    const { container } = render(<BranchSwitcher />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a plain read-only label, no dropdown, for a user with only one authorized branch", async () => {
    mockOrgState({ myBranches: [parklands], activeBranch: parklands });

    render(<BranchSwitcher />);

    expect(screen.getByText("Active Branch")).toBeInTheDocument();
    expect(screen.getByText("parklands")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("displays the current active branch on the closed dropdown trigger", () => {
    mockOrgState();

    render(<BranchSwitcher />);

    expect(
      screen.getByRole("button", { name: "Active branch" })
    ).toHaveTextContent("parklands");
  });

  it("opens the dropdown and lists every authorized branch, marking the current one selected", async () => {
    const user = userEvent.setup();
    mockOrgState();

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));

    const listbox = screen.getByRole("listbox", { name: "Branches" });
    const options = within(listbox).getAllByRole("option");

    expect(options).toHaveLength(2);

    const currentOption = within(listbox).getByRole("option", {
      name: /parklands/,
    });
    const otherOption = within(listbox).getByRole("option", {
      name: "westlands",
    });

    expect(currentOption).toHaveAttribute("aria-selected", "true");
    expect(otherOption).toHaveAttribute("aria-selected", "false");
  });

  it("never lists a branch the user is not authorized for (only what myBranches provides)", async () => {
    const user = userEvent.setup();
    mockOrgState({ myBranches: [parklands, westlands] });

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));

    expect(screen.queryByText("some-other-clinic")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("listbox")).getAllByRole("option")
    ).toHaveLength(2);
  });

  it("selecting another branch calls the existing switchActiveBranch mechanism, reloads org state, and hard-navigates to /admin", async () => {
    const user = userEvent.setup();
    switchActiveBranch.mockResolvedValue(undefined);
    const reload = mockOrgState();

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));
    await user.click(screen.getByRole("option", { name: "westlands" }));

    await waitFor(() => {
      expect(switchActiveBranch).toHaveBeenCalledWith("branch-2");
    });

    expect(reload).toHaveBeenCalled();
    // A full window.location assignment, not router.push()/refresh() -
    // see the setup above for why a soft navigation isn't sufficient.
    expect(locationStub.href).toBe("/admin");
  });

  it("clicking the already-active branch is a no-op - closes the menu without switching", async () => {
    const user = userEvent.setup();
    mockOrgState();

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));
    await user.click(screen.getByRole("option", { name: /parklands/ }));

    expect(switchActiveBranch).not.toHaveBeenCalled();
    expect(locationStub.href).toBe("");
  });

  it("disables every branch option while a switch is in flight, preventing repeated clicks", async () => {
    const user = userEvent.setup();
    let resolveSwitch: () => void = () => {};
    switchActiveBranch.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSwitch = resolve;
      })
    );
    mockOrgState();

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));
    await user.click(screen.getByRole("option", { name: "westlands" }));

    expect(screen.getByRole("option", { name: /parklands/ })).toBeDisabled();
    expect(screen.getByText("Switching...")).toBeInTheDocument();

    resolveSwitch();
    await waitFor(() =>
      expect(switchActiveBranch).toHaveBeenCalledTimes(1)
    );
  });

  it("shows an error toast and keeps the current branch active if switching fails", async () => {
    const user = userEvent.setup();
    switchActiveBranch.mockRejectedValue(new Error("boom"));
    const { toast } = await import("sonner");
    mockOrgState();

    render(<BranchSwitcher />);

    await user.click(screen.getByRole("button", { name: "Active branch" }));
    await user.click(screen.getByRole("option", { name: "westlands" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    expect(locationStub.href).toBe("");
  });
});
