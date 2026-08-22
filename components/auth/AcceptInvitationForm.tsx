"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";

import { supabase } from "@/lib/supabase";
import { getSafeErrorMessage, logError } from "@/lib/logError";
import { acceptPendingInvitationIfNeeded } from "@/services/clinic";
import {
  acceptInvitation,
  getInvitationDetails,
} from "@/services/staffInvitations";
import { getOrganizationInvitationDetails } from "@/services/organizations";

import { useAuth } from "@/contexts/AuthContext";
import useOrganization from "@/hooks/useOrganization";

interface Props {
  token: string;
}

/**
 * Unifies the two lookup shapes (InvitationDetails vs
 * OrganizationInvitationDetails, types/staffInvitation.ts /
 * types/organization.ts) into what this form actually displays.
 * organizationName is only ever set for a branch invitation - the
 * independent-clinic get_invitation_details RPC has no such column and
 * is never modified to add one.
 */
interface DisplayInvitation {
  email: string;
  role: string;
  fullName: string;
  clinicName: string;
  organizationName: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; invitation: DisplayInvitation };

export default function AcceptInvitationForm({
  token,
}: Props) {
  const router = useRouter();

  const { authUser, refreshProfile } = useAuth();
  const { reload: reloadOrganization } = useOrganization();

  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Try the branch-invitation lookup first, exactly like
        // services/staffInvitations.ts#acceptInvitation does for the
        // actual accept RPC - it returns a row only for a branch
        // invitation, so this is a display-only enhancement (shows the
        // organization name) that never touches or duplicates the
        // acceptance logic itself.
        const organizationInvitation =
          await getOrganizationInvitationDetails(token);

        const invitation = organizationInvitation
          ? {
              email: organizationInvitation.email,
              role: organizationInvitation.role,
              fullName: organizationInvitation.full_name,
              clinicName: organizationInvitation.clinic_name,
              organizationName: organizationInvitation.organization_name,
              accepted_at: organizationInvitation.accepted_at,
              expires_at: organizationInvitation.expires_at,
            }
          : await (async () => {
              const independent = await getInvitationDetails(token);

              return independent
                ? {
                    email: independent.email,
                    role: independent.role,
                    fullName: independent.full_name,
                    clinicName: independent.clinic_name,
                    organizationName: null,
                    accepted_at: independent.accepted_at,
                    expires_at: independent.expires_at,
                  }
                : null;
            })();

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
              "This invitation has expired. Ask your clinic admin to resend it.",
          });
          return;
        }

        setState({
          status: "ready",
          invitation: {
            email: invitation.email,
            role: invitation.role,
            fullName: invitation.fullName,
            clinicName: invitation.clinicName,
            organizationName: invitation.organizationName,
          },
        });
      } catch (error) {
        logError(
          "[AcceptInvitationForm] Failed to load invitation:",
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

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (state.status !== "ready" || submitting) return;

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      const { data, error } = await supabase.auth.signUp({
        email: state.invitation.email,
        password,
        options: {
          data: {
            pending_invitation_token: token,
          },
        },
      });

      if (error) throw error;

      if (data.session) {
        await acceptPendingInvitationIfNeeded();

        toast.success(
          `Welcome to ${state.invitation.clinicName}!`
        );

        router.push("/admin");
        router.refresh();
      } else {
        toast.success(
          "Check your email to confirm your account, then log in to finish joining the clinic."
        );

        router.push("/auth/login");
      }
    } catch (error: unknown) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Unable to accept this invitation.",
          "[AcceptInvitationForm] Failed to accept invitation:"
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * A visitor who already has a session (most commonly: a multi-branch
   * organization member who already accepted one branch invitation, now
   * accepting an additional one, possibly with a different role) never
   * goes through signUp() - they already have a password. This calls
   * acceptInvitation(token) directly with their EXISTING session, then
   * refreshes both AuthContext and OrganizationContext so the Sidebar/
   * branch switcher immediately reflect the new branch membership
   * without requiring a manual reload.
   */
  async function handleAcceptWithExistingSession() {
    if (state.status !== "ready" || submitting) return;

    try {
      setSubmitting(true);

      await acceptInvitation(token);

      await Promise.all([refreshProfile(), reloadOrganization()]);

      toast.success(`Welcome to ${state.invitation.clinicName}!`);

      router.push("/admin");
      router.refresh();
    } catch (error: unknown) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Unable to accept this invitation.",
          "[AcceptInvitationForm] Failed to accept invitation with existing session:"
        )
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
        {invitation.organizationName && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">
              Organization
            </span>
            <span className="font-semibold text-slate-800">
              {invitation.organizationName}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {invitation.organizationName ? "Branch" : "Clinic"}
          </span>
          <span className="font-semibold text-slate-800">
            {invitation.clinicName}
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
      </div>

      {authUser ? (
        authUser.email?.toLowerCase() ===
        invitation.email.toLowerCase() ? (
          <div className="space-y-4">
            <p className="text-center text-slate-600">
              You&apos;re signed in as{" "}
              <strong>{authUser.email}</strong>.
            </p>

            <Button
              className="w-full"
              disabled={submitting}
              onClick={handleAcceptWithExistingSession}
            >
              {submitting
                ? "Joining..."
                : `Accept and Join ${invitation.clinicName}`}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-slate-600">
              You&apos;re signed in as{" "}
              <strong>{authUser.email}</strong>, but this
              invitation was sent to{" "}
              <strong>{invitation.email}</strong>. Log out to
              accept it with the right account.
            </p>

            <Button
              className="w-full"
              onClick={async () => {
                await supabase.auth.signOut();
                router.refresh();
              }}
            >
              Log Out
            </Button>
          </div>
        )
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) =>
              setConfirmPassword(e.target.value)
            }
          />

          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
          >
            {submitting
              ? "Creating Account..."
              : "Join Clinic"}
          </Button>
        </form>
      )}
    </div>
  );
}
