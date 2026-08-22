"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InsuranceProviderChecklist from "@/components/insurance/InsuranceProviderChecklist";

import { supabase } from "@/lib/supabase";
import { provisionPendingOrganizationIfNeeded } from "@/services/organizations";
import { getInsuranceProviders } from "@/services/insurance";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { InsuranceProvider } from "@/types/insurance";

import { toast } from "sonner";

/**
 * Mirrors SignupForm.tsx's structure and behavior exactly (same fields
 * where they overlap, same signUp()-then-provision-then-redirect shape,
 * same deferred-session handling) - the only real differences are the
 * two extra fields (organization name, initial branch name) and calling
 * services/organizations.ts#provisionPendingOrganizationIfNeeded instead
 * of services/clinic.ts#provisionPendingClinicIfNeeded.
 */
export default function MultiBranchSignupForm() {
  const router = useRouter();

  const [organizationName, setOrganizationName] = useState("");
  const [branchName, setBranchName] = useState("");
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

    if (
      !organizationName.trim() ||
      !branchName.trim() ||
      !fullName.trim() ||
      !email.trim() ||
      !password
    ) {
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
            pending_organization_name: organizationName.trim(),
            pending_branch_name: branchName.trim(),
            pending_full_name: fullName.trim(),
            pending_insurance_provider_ids: selectedInsuranceIds,
          },
        },
      });

      if (error) throw error;

      if (data.session) {
        console.log(
          "[onboarding] session available immediately - provisioning organization before redirecting"
        );

        await provisionPendingOrganizationIfNeeded();

        console.log(
          "[onboarding] organization provisioning complete, redirecting to /admin"
        );

        toast.success("Organization created. Welcome to DentalFlow!");

        router.push("/admin");
        router.refresh();
      } else {
        console.log(
          "[onboarding] no session returned from signUp() - email confirmation is required, deferring organization creation until first login"
        );

        toast.success(
          "Check your email to confirm your account, then log in to finish setting up your organization."
        );

        router.push("/auth/login");
      }
    } catch (error: unknown) {
      toast.error(getSafeErrorMessage(error, "Unable to create account."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Input
        placeholder="Organization name (e.g. SmileCare Dental Group)"
        value={organizationName}
        onChange={(e) => setOrganizationName(e.target.value)}
      />

      <Input
        placeholder="Initial branch name (e.g. Westlands Branch)"
        value={branchName}
        onChange={(e) => setBranchName(e.target.value)}
      />

      <Input
        placeholder="Your full name (CEO / Owner)"
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
          Which insurance providers does your organization work with?
        </label>

        <p className="mb-3 text-sm text-slate-500">
          Optional - applied to your initial branch; you can add providers
          to other branches later.
        </p>

        <InsuranceProviderChecklist
          providers={insuranceProviders}
          selectedIds={selectedInsuranceIds}
          onToggle={toggleInsuranceProvider}
          emptyMessage="Loading insurance providers..."
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating Organization..." : "Create Organization"}
      </Button>
    </form>
  );
}
