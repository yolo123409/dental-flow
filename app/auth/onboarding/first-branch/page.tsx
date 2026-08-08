"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import Card from "@/components/ui/Card";
import FirstBranchForm from "@/components/auth/FirstBranchForm";

import { useAuth } from "@/contexts/AuthContext";

export default function FirstBranchOnboardingPage() {
  const router = useRouter();

  const {
    authUser,
    profile,
    organizationUser,
    hasOrganizationBranches,
    loading,
  } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!authUser) {
      router.replace("/auth/login");
      return;
    }

    // The organization already has at least one branch, or this account
    // isn't part of an organization at all - nothing to onboard here.
    if (hasOrganizationBranches) {
      router.replace(profile ? "/admin" : "/admin/organization/overview");
      return;
    }

    if (!organizationUser) {
      router.replace("/admin");
    }
  }, [
    loading,
    authUser,
    profile,
    organizationUser,
    hasOrganizationBranches,
    router,
  ]);

  if (
    loading ||
    !authUser ||
    hasOrganizationBranches ||
    !organizationUser
  ) {
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
              {organizationUser.role === "CEO"
                ? "Create the first branch for your organization."
                : "Waiting for your organization's CEO to create the first branch."}
            </p>
          </div>

          {organizationUser.role === "CEO" ? (
            <FirstBranchForm organizationUser={organizationUser} />
          ) : (
            <p className="text-center text-sm text-slate-500">
              Check back once your organization has at least one branch -
              you&apos;ll be able to switch into it from here.
            </p>
          )}
        </Card>
      </div>
    </main>
  );
}
