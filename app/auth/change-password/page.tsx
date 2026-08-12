"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logError";
import { validatePassword } from "@/lib/passwordPolicy";
import { useAuth } from "@/contexts/AuthContext";

export default function ChangePasswordPage() {
  const router = useRouter();

  const { authUser, loading, refreshProfile } = useAuth();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // This page isn't wrapped by ProtectedRoute (that only wraps /admin/**,
  // see components/auth/ProtectedRoute.tsx) - it needs its own minimal
  // "must be logged in" guard, same shape as app/auth/login/page.tsx's.
  useEffect(() => {
    if (!loading && !authUser) {
      router.replace("/auth/login");
    }
  }, [loading, authUser, router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (submitting) return;

    const policy = validatePassword(newPassword);

    if (!policy.valid) {
      toast.error(policy.message);
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      // must_change_password lives in app_metadata, which the client can
      // never write directly (see lib/supabase-request.ts) - this is the
      // one call that's allowed to clear it, and it re-authenticates via
      // the caller's own token the same way every other app/api/** route
      // in this feature does.
      const response = await fetch("/api/auth/complete-password-change", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.message ?? "Unable to complete the password change."
        );
      }

      toast.success("Password updated. Welcome to DentalFlow!");

      await refreshProfile();

      router.push("/admin");
      router.refresh();
    } catch (error) {
      logError("[ChangePasswordPage] Failed to change password:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update password."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !authUser) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md">
        <Card>
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-blue-600">
              Create Your Password
            </h1>

            <p className="mt-3 text-slate-500">
              For security, you must set a new password before continuing
              into DentalFlow.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block font-medium">New Password</label>

              <Input
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block font-medium">
                Confirm New Password
              </label>

              <Input
                type="password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <p className="text-xs text-slate-500">
              At least 8 characters, with an uppercase letter, a lowercase
              letter, and a number.
            </p>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
