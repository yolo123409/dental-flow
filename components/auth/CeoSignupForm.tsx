"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

import { supabase } from "@/lib/supabase";
import { provisionPendingOrganizationIfNeeded } from "@/services/organizations";

import { toast } from "sonner";

export default function CeoSignupForm() {
  const router = useRouter();

  const [organizationName, setOrganizationName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (loading) return;

    if (
      !organizationName.trim() ||
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
            pending_full_name: fullName.trim(),
          },
        },
      });

      console.log("[onboarding] CEO signUp() result:", {
        hasSession: !!data.session,
        userId: data.user?.id,
        error,
      });

      if (error) throw error;

      if (data.session) {
        console.log(
          "[onboarding] session available immediately - provisioning organization before redirecting"
        );

        await provisionPendingOrganizationIfNeeded();

        toast.success("Organization created. Let's set up your first branch.");

        router.push("/auth/onboarding/first-branch");
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
        placeholder="Organization name"
        value={organizationName}
        onChange={(e) => setOrganizationName(e.target.value)}
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

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating Account..." : "Create Organization"}
      </Button>
    </form>
  );
}
