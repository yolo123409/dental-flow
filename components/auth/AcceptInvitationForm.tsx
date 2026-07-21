"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";

import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logError";
import { acceptPendingInvitationIfNeeded } from "@/services/clinic";
import { getInvitationDetails } from "@/services/staffInvitations";
import { InvitationDetails } from "@/types/staffInvitation";

interface Props {
  token: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; invitation: InvitationDetails };

export default function AcceptInvitationForm({
  token,
}: Props) {
  const router = useRouter();

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
        const invitation = await getInvitationDetails(token);

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

        setState({ status: "ready", invitation });
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
          `Welcome to ${state.invitation.clinic_name}!`
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
      logError(
        "[AcceptInvitationForm] Failed to accept invitation:",
        error
      );

      toast.error(
        error instanceof Error
          ? error.message
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
            Clinic
          </span>
          <span className="font-semibold text-slate-800">
            {invitation.clinic_name}
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
    </div>
  );
}
