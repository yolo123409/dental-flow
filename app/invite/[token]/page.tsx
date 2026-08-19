"use client";

import { useParams } from "next/navigation";

import Card from "@/components/ui/Card";
import AcceptInvitationForm from "@/components/auth/AcceptInvitationForm";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Deliberately does NOT redirect an already-authenticated visitor away
 * unconditionally - a multi-branch organization member who already
 * accepted one branch invitation (and so already has a session) must be
 * able to accept a SECOND branch invitation (e.g. a CEO inviting the
 * same person to another branch, possibly with a different role)
 * without logging out first. AcceptInvitationForm itself decides what
 * an authenticated visitor sees: an "Accept as [email]" flow using
 * their existing session when the invitation email matches, or a
 * "log out to accept a different invitation" message when it belongs
 * to someone else.
 */
export default function InvitePage() {
  const params = useParams();
  const token = String(params.token ?? "");

  const { loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        Loading...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md">
        <Card>
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-bold text-blue-600">
              Dental Flow
            </h1>

            <p className="mt-3 text-slate-500">
              You&apos;ve been invited to join a clinic.
            </p>
          </div>

          <AcceptInvitationForm token={token} />
        </Card>
      </div>
    </main>
  );
}
