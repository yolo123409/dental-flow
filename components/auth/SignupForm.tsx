"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InsuranceProviderChecklist from "@/components/insurance/InsuranceProviderChecklist";

import { supabase } from "@/lib/supabase";
import { provisionPendingClinicIfNeeded } from "@/services/clinic";
import { getInsuranceProviders } from "@/services/insurance";
import { logError } from "@/lib/logError";

import { InsuranceProvider } from "@/types/insurance";

import { toast } from "sonner";

export default function SignupForm() {
  const router = useRouter();

  const [clinicName, setClinicName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [insuranceProviders, setInsuranceProviders] = useState<
    InsuranceProvider[]
  >([]);
  const [selectedInsuranceIds, setSelectedInsuranceIds] = useState<
    string[]
  >([]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getInsuranceProviders()
      .then(setInsuranceProviders)
      .catch((error) => {
        // Non-blocking - insurance selection is optional at signup, so a
        // failure to load the master list shouldn't stop anyone from
        // creating an account.
        logError(
          "[onboarding] Failed to load insurance providers:",
          error
        );
      });
  }, []);

  function toggleInsuranceProvider(providerId: string) {
    setSelectedInsuranceIds((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId]
    );
  }

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (loading) return;

    if (!clinicName.trim() || !fullName.trim() || !email.trim() || !password) {
      toast.error("Please complete all fields.");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            pending_clinic_name: clinicName.trim(),
            pending_full_name: fullName.trim(),
            pending_insurance_provider_ids: selectedInsuranceIds,
          },
        },
      });

      console.log("[onboarding] signUp() result:", {
        hasSession: !!data.session,
        userId: data.user?.id,
        error,
      });

      if (error) throw error;

      if (data.session) {
        console.log(
          "[onboarding] session available immediately - provisioning clinic before redirecting"
        );

        await provisionPendingClinicIfNeeded();

        console.log(
          "[onboarding] provisioning complete, redirecting to /admin"
        );

        toast.success("Clinic created. Welcome to DentalFlow!");

        router.push("/admin");
        router.refresh();
      } else {
        console.log(
          "[onboarding] no session returned from signUp() - email confirmation is required, deferring clinic creation until first login"
        );

        toast.success(
          "Check your email to confirm your account, then log in to finish setting up your clinic."
        );

        router.push("/auth/login");
      }
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        toast.error(error.message || "Unable to create account.");
      } else {
        toast.error("Unable to create account.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Input
        placeholder="Clinic name"
        value={clinicName}
        onChange={(e) => setClinicName(e.target.value)}
      />

      <Input
        placeholder="Your full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />

      <Input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Which insurance providers does your clinic work with?
        </label>

        <p className="mb-3 text-sm text-slate-500">
          Optional - you can select none now and add providers later.
        </p>

        <InsuranceProviderChecklist
          providers={insuranceProviders}
          selectedIds={selectedInsuranceIds}
          onToggle={toggleInsuranceProvider}
          emptyMessage="Loading insurance providers..."
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating Account..." : "Create Account"}
      </Button>
    </form>
  );
}
