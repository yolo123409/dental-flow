"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import AccessDenied from "@/components/auth/AccessDenied";

import { useAuth } from "@/contexts/AuthContext";

import {
  getMyOrganization,
  updateOrganization,
} from "@/services/organizations";

export default function OrganizationSettingsPage() {
  const { organizationUser, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const org = await getMyOrganization(organizationUser.organization_id);

      setName(org?.name ?? "");
      setSavedName(org?.name ?? "");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load organization settings."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    if (organizationUser?.role === "CEO") {
      load();
    } else {
      setLoading(false);
    }
  }, [organizationUser, load]);

  async function handleSave() {
    if (!organizationUser) return;

    if (!name.trim()) {
      toast.error("Organization name is required.");
      return;
    }

    try {
      setSaving(true);

      await updateOrganization(organizationUser.organization_id, {
        name: name.trim(),
      });

      setSavedName(name.trim());

      toast.success("Organization updated.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update organization."
      );
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <PageContainer>
        <LoadingSpinner text="Loading organization settings..." />
      </PageContainer>
    );
  }

  if (organizationUser?.role !== "CEO") {
    return (
      <PageContainer>
        <AccessDenied />
      </PageContainer>
    );
  }

  const isDirty = name.trim() !== savedName;

  return (
    <PageContainer>
      <div>
        <h1 className="font-display text-3xl font-bold">
          Organization Settings
        </h1>

        <p className="mt-2 text-mineral">
          Manage your organization's basic details.
        </p>
      </div>

      <Card title="General">
        <div className="max-w-md space-y-5">
          <FormInput
            label="Organization Name"
            value={name}
            onChange={setName}
          />

          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
}
