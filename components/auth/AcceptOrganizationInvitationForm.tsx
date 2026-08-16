"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";

import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logError";
import {
  AcceptedOrganizationInvitation,
  getOrganizationInvitationDetails,
  acceptOrganizationInvitation,
  checkInvitationEmailHasAccount,
} from "@/services/organizationInvitations";
import {
  getMyOrganizationBranchIds,
  switchActiveBranch,
} from "@/services/organizations";
import { OrganizationInvitationDetails } from "@/types/organizationInvitation";

interface Props {
  token: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; invitation: OrganizationInvitationDetails };

export default function AcceptOrganizationInvitationForm({
  token,
}: Props) {
  const router = useRouter();

  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  // Whether the invited email already has a DentalFlow account - null
  // while still checking. When true, the form below swaps to a sign-in
  // branch instead of supabase.auth.signUp(), which cannot succeed for an
  // email that already has an account.
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const invitation = await getOrganizationInvitationDetails(token);

        if (cancelled) return;

        if (!invitation) {
          setState({
            status: "invalid",
            message: "This invitation link is invalid.",
          });
          return;
        }

        if (invitation.accepted_at) {
          setState({
            status: "invalid",
            message:
              "This invitation has already been accepted. Log in instead.",
          });
          return;
        }

        if (new Date(invitation.expires_at) < new Date()) {
          setState({
            status: "invalid",
            message:
              "This invitation has expired. Ask the organization's CEO to resend it.",
          });
          return;
        }

        setState({ status: "ready", invitation });

        // Pre-fills the inviter's hint, but the invitee can still change
        // it - this is never treated as authoritative (see
        // resolve_organization_user_identity, migration 0034).
        if (invitation.full_name) {
          setFullName(invitation.full_name);
        }

        checkInvitationEmailHasAccount(token)
          .then((result) => {
            if (!cancelled) setHasAccount(result);
          })
          .catch((error) => {
            logError(
              "[AcceptOrganizationInvitationForm] Failed to check for an existing account:",
              error
            );

            // Fail open to the ordinary signup form - a false negative
            // here just means signUp() surfaces its own "already
            // registered" error, which is a worse but still safe outcome.
            if (!cancelled) setHasAccount(false);
          });
      } catch (error) {
        logError(
          "[AcceptOrganizationInvitationForm] Failed to load invitation:",
          error
        );

        if (!cancelled) {
          setState({
            status: "invalid",
            message: "This invitation link is invalid.",
          });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * Runs once organization_users membership exists (accept_organization_invitation
   * just succeeded). Two things a plain router.push("/admin") skipped
   * entirely, which is why an accepted branch invitee previously landed in
   * a broken/empty shell:
   *
   * 1. No clinic_users row is ever created by acceptance itself - it's only
   *    lazily provisioned by switch_active_branch, and nothing was calling
   *    that automatically. A single-branch invitee has exactly one branch
   *    they could possibly mean, so auto-switch into it now (multi-branch/
   *    'all' access invitees keep the existing behavior: land on
   *    Organization Overview and pick via the existing BranchSwitcher -
   *    nothing new built for that case).
   * 2. A soft router.push race against AuthContext's own SIGNED_IN/
   *    USER_UPDATED-triggered loadProfile() calls (both of which started
   *    BEFORE this invitation was accepted, so can resolve with stale
   *    "no organization membership yet" data) could momentarily mount
   *    Dashboard/Patients/etc with no clinic context at all. A full reload
   *    forces AuthContext to re-initialize from scratch against the
   *    now-committed database state - the same pattern BranchSwitcher
   *    already uses after switchActiveBranch/switching to "All Branches".
   */
  async function completeAcceptance(
    accepted: AcceptedOrganizationInvitation,
    organizationName: string
  ) {
    try {
      const branchIds = await getMyOrganizationBranchIds(
        accepted.organization_id
      );

      if (branchIds.length === 1) {
        await switchActiveBranch(branchIds[0]);
      }
    } catch (error) {
      // Never block landing in the app over this - worst case they land on
      // Organization Overview and switch branches manually, same as any
      // multi-branch member already does today.
      logError(
        "[AcceptOrganizationInvitationForm] Auto branch-switch failed:",
        error
      );
    }

    toast.success(`Welcome to ${organizationName}!`);

    window.location.href = "/admin";
  }

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (state.status !== "ready" || submitting) return;

    if (!fullName.trim()) {
      toast.error("Please enter your full name.");
      return;
    }

    if (hasAccount) {
      if (!password) {
        toast.error("Please enter your password.");
        return;
      }
    } else {
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters.");
        return;
      }

      if (password !== confirmPassword) {
        toast.error("Passwords do not match.");
        return;
      }
    }

    try {
      setSubmitting(true);

      if (hasAccount) {
        // The existing account must authenticate as itself, not be
        // silently signed into by this flow - signInWithPassword is the
        // only door in. acceptOrganizationInvitation already works from
        // any authenticated session whose JWT email matches the
        // invitation, regardless of how that session was established.
        const { error: signInError } = await supabase.auth.signInWithPassword(
          {
            email: state.invitation.email,
            password,
          }
        );

        if (signInError) throw signInError;

        // organization_users has no full_name/email columns of its own -
        // identity is resolved server-side from clinic_users, falling back
        // to this exact auth metadata key (see
        // resolve_organization_user_identity, migration 0034). The signup
        // branch already gets this via supabase.auth.signUp()'s options.data;
        // an existing account signing in here needs it set explicitly.
        await supabase.auth.updateUser({
          data: { pending_full_name: fullName.trim() },
        });

        const accepted = await acceptOrganizationInvitation(
          token,
          fullName.trim()
        );

        await completeAcceptance(accepted, state.invitation.organization_name);

        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: state.invitation.email,
        password,
        options: {
          data: {
            pending_organization_invitation_token: token,
            pending_full_name: fullName.trim(),
          },
        },
      });

      if (error) throw error;

      if (data.session) {
        const accepted = await acceptOrganizationInvitation(
          token,
          fullName.trim()
        );

        await completeAcceptance(accepted, state.invitation.organization_name);
      } else {
        toast.success(
          "Check your email to confirm your account, then log in to finish joining the organization."
        );

        router.push("/auth/login");
      }
    } catch (error: unknown) {
      logError(
        "[AcceptOrganizationInvitationForm] Failed to accept invitation:",
        error
      );

      toast.error(
        error instanceof Error
          ? error.message
          : hasAccount
          ? "Incorrect password, or unable to accept this invitation."
          : "Unable to accept this invitation."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <p className="text-center text-slate-500">
        Checking your invitation...
      </p>
    );
  }

  if (state.status === "invalid") {
    return (
      <div className="space-y-6 text-center">
        <p className="text-slate-600">{state.message}</p>

        <Button
          className="w-full"
          onClick={() => router.push("/auth/login")}
        >
          Go to Login
        </Button>
      </div>
    );
  }

  const { invitation } = state;

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Organization
          </span>
          <span className="font-semibold text-slate-800">
            {invitation.organization_name}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Email
          </span>
          <span className="font-semibold text-slate-800">
            {invitation.email}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Role
          </span>
          <Badge color="blue">{invitation.role}</Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Branch Access
          </span>
          <span className="font-semibold text-slate-800">
            {invitation.branch_access === "all"
              ? "All Branches"
              : "Selected Branches"}
          </span>
        </div>
      </div>

      {invitation.message && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm italic text-slate-600">
          &ldquo;{invitation.message}&rdquo;
        </p>
      )}

      {hasAccount && (
        <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">
          An account already exists for {invitation.email}. Sign in below to
          join this organization - no new account is created.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          placeholder="Your full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <Input
          type="password"
          placeholder={hasAccount ? "Your password" : "Create a password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {!hasAccount && (
          <Input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) =>
              setConfirmPassword(e.target.value)
            }
          />
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="w-full"
        >
          {submitting
            ? hasAccount
              ? "Signing In..."
              : "Creating Account..."
            : hasAccount
            ? "Sign In & Join"
            : "Join Organization"}
        </Button>
      </form>
    </div>
  );
}
