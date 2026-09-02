import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

const signOut = vi.fn();
vi.mock("@/services/auth", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authState: {
  authUser: unknown;
  profile: unknown;
  loading: boolean;
  profileLoading: boolean;
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

const { default: ProtectedRoute } = await import("./ProtectedRoute");

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  signOut.mockReset();
});

describe("ProtectedRoute (Critical Safety Closure fix, Audit II Critical #3 - the paired UX fix)", () => {
  it("shows a loading state while auth or the clinic profile is still resolving", () => {
    authState = {
      authUser: { id: "auth-1" },
      profile: null,
      loading: false,
      profileLoading: true,
    };

    render(
      <ProtectedRoute>
        <p>Protected content</p>
      </ProtectedRoute>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders the children normally for an authenticated user with a visible clinic_users profile", () => {
    authState = {
      authUser: { id: "auth-1" },
      profile: { id: "cu-1", role: "Owner" },
      loading: false,
      profileLoading: false,
    };

    render(
      <ProtectedRoute>
        <p>Protected content</p>
      </ProtectedRoute>
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  // The core case this fix addresses: a valid auth session (authUser set)
  // whose clinic_users row is invisible - either because they were
  // deleted, or (per the server-side RLS fix in migrations 0130/0131)
  // because they were suspended. Both now resolve to profile === null,
  // and the app can't and shouldn't try to tell them apart.
  it("shows a clear access-removed message instead of rendering children when authUser exists but profile is null", () => {
    authState = {
      authUser: { id: "auth-1" },
      profile: null,
      loading: false,
      profileLoading: false,
    };

    render(
      <ProtectedRoute>
        <p>Protected content</p>
      </ProtectedRoute>
    );

    expect(
      screen.getByText(/access has been removed or suspended/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("signs out and redirects to login when Sign Out is clicked from the access-removed message", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");

    authState = {
      authUser: { id: "auth-1" },
      profile: null,
      loading: false,
      profileLoading: false,
    };

    render(
      <ProtectedRoute>
        <p>Protected content</p>
      </ProtectedRoute>
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(signOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/auth/login");
  });
});
