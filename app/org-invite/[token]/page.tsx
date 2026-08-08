"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import AcceptOrganizationInvitationForm from "@/components/auth/AcceptOrganizationInvitationForm";

import { useAuth } from "@/contexts/AuthContext";

export default function OrganizationInvitePage() {
  const params = useParams();
  const token = String(params.token ?? "");

  const router = useRouter();

  const { authUser, loading } = useAuth();

  useEffect(() => {
    if (!loading && authUser) {
      toast(
        "You're already signed in - log out to accept a different invitation."
      );

      router.replace("/admin");
    }
  }, [loading, authUser, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        Loading...
      </main>
    );
  }

  if (authUser) {
    return null;
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
              You&apos;ve been invited to join an organization.
            </p>
          </div>

          <AcceptOrganizationInvitationForm token={token} />
        </Card>
      </div>
    </main>
  );
}
