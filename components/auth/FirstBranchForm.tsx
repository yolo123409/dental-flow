"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

import { createClinicWithAdmin } from "@/services/clinic";
import { setStoredActiveClinicId } from "@/services/clinicUsers";
import { resolveBranchOwnerIdentity } from "@/services/organizations";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationUser } from "@/types/organization";

interface Props {
  organizationUser: OrganizationUser;
}

export default function FirstBranchForm({
  organizationUser,
}: Props) {
  const router = useRouter();
  const { authUser } = useAuth();

  const [branchName, setBranchName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (loading) return;

    if (!branchName.trim()) {
      toast.error("Please enter a branch name.");
      return;
    }

    let identity: { fullName: string; email: string };

    try {
      identity = resolveBranchOwnerIdentity(organizationUser, authUser);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create branch."
      );

      return;
    }

    try {
      setLoading(true);

      const result = await createClinicWithAdmin({
        clinicName: branchName.trim(),
        fullName: identity.fullName,
        email: identity.email,
        organizationId: organizationUser.organization_id,
      });

      const created = result?.[0] as
        | { clinic_id: string }
        | undefined;

      // Land in the branch just created for the rest of this session,
      // rather than the default "no branch selected -> Organization
      // Overview" behavior a fresh org member would otherwise get.
      if (created?.clinic_id) {
        setStoredActiveClinicId(created.clinic_id);
      }

      toast.success("Branch created. Welcome to DentalFlow!");

      router.push("/admin");
      router.refresh();
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        toast.error(error.message || "Unable to create branch.");
      } else {
        toast.error("Unable to create branch.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Input
        placeholder="Branch name (e.g. Headquarters)"
        value={branchName}
        onChange={(e) => setBranchName(e.target.value)}
      />

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating Branch..." : "Create Branch"}
      </Button>
    </form>
  );
}
