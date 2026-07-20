"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Card from "@/components/ui/Card";
import SignupForm from "@/components/auth/SignupForm";

import { useAuth } from "@/contexts/AuthContext";

export default function SignupPage() {
  const router = useRouter();

  const { authUser, loading } = useAuth();

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
              Set up your clinic in a few seconds.
            </p>
          </div>

          <SignupForm />

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
