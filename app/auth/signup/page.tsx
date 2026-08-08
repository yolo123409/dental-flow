"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Card from "@/components/ui/Card";
import SignupForm from "@/components/auth/SignupForm";
import CeoSignupForm from "@/components/auth/CeoSignupForm";
import AccountTypeSelector from "@/components/auth/AccountTypeSelector";

import { useAuth } from "@/contexts/AuthContext";

type AccountType = "clinic" | "organization" | null;

export default function SignupPage() {
  const router = useRouter();

  const { authUser, loading } = useAuth();

  const [accountType, setAccountType] =
    useState<AccountType>(null);

  useEffect(() => {
    if (!loading && authUser) {
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
              {accountType === null
                ? "How will you use DentalFlow?"
                : accountType === "clinic"
                ? "Set up your clinic in a few seconds."
                : "Register your organization and become its Primary CEO."}
            </p>
          </div>

          {accountType === null && (
            <AccountTypeSelector onSelect={setAccountType} />
          )}

          {accountType === "clinic" && (
            <>
              <SignupForm />

              <button
                type="button"
                onClick={() => setAccountType(null)}
                className="mt-4 block w-full text-center text-sm font-medium text-mineral hover:text-graphite"
              >
                ← Choose a different account type
              </button>
            </>
          )}

          {accountType === "organization" && (
            <>
              <CeoSignupForm />

              <button
                type="button"
                onClick={() => setAccountType(null)}
                className="mt-4 block w-full text-center text-sm font-medium text-mineral hover:text-graphite"
              >
                ← Choose a different account type
              </button>
            </>
          )}

          <p className="mt-8 text-center text-slate-600">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="font-semibold text-blue-600"
            >
              Log in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
