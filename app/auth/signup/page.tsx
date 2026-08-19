"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import Card from "@/components/ui/Card";
import SignupForm from "@/components/auth/SignupForm";
import MultiBranchSignupForm from "@/components/auth/MultiBranchSignupForm";
import ClinicTypeSelector, {
  ClinicType,
} from "@/components/auth/ClinicTypeSelector";

import { useAuth } from "@/contexts/AuthContext";

export default function SignupPage() {
  const router = useRouter();

  const { authUser, loading } = useAuth();

  // Null = clinic type not chosen yet (the selector step). Independent
  // Clinic renders the existing, untouched SignupForm exactly as it
  // always has; Multi-Branch Organization renders the new
  // MultiBranchSignupForm. Neither form's own state is shared with the
  // other - switching away and back is a deliberate re-decision, so it's
  // fine (and simplest/lowest-risk) for the unmounted form to reset.
  const [clinicType, setClinicType] = useState<ClinicType | null>(null);

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
              {clinicType === null
                ? "How will you use Dental Flow?"
                : "Set up your clinic in a few seconds."}
            </p>
          </div>

          {clinicType === null && (
            <ClinicTypeSelector onSelect={setClinicType} />
          )}

          {clinicType !== null && (
            <div>
              <button
                type="button"
                onClick={() => setClinicType(null)}
                className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-eucalyptus"
              >
                <ArrowLeft size={16} />
                Back
              </button>

              {clinicType === "independent" ? (
                <SignupForm />
              ) : (
                <MultiBranchSignupForm />
              )}
            </div>
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
