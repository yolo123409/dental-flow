"use client";

import { useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { createClinicWithAdmin } from "@/services/clinic";
import { resolveBranchOwnerIdentity } from "@/services/organizations";
import { logError } from "@/lib/logError";

import { useAuth } from "@/contexts/AuthContext";
import { OrganizationUser } from "@/types/organization";

interface Props {
  open: boolean;
  organizationUser: OrganizationUser;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export default function AddBranchModal({
  open,
  organizationUser,
  onClose,
  onSuccess,
}: Props) {
  const { authUser } = useAuth();

  const [branchName, setBranchName] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setBranchName("");
  }

  function handleClose() {
    if (saving) return;

    reset();
    onClose();
  }

  async function handleCreate() {
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
      setSaving(true);

      await createClinicWithAdmin({
        clinicName: branchName.trim(),
        fullName: identity.fullName,
        email: identity.email,
        organizationId: organizationUser.organization_id,
      });

      toast.success("Branch created.");

      reset();
      onClose();

      await onSuccess();
    } catch (error) {
      logError("[AddBranchModal] createClinicWithAdmin failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create branch."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add Branch"
      onClose={handleClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={saving}
          >
            Cancel
          </Button>

          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create Branch"}
          </Button>
        </>
      }
    >
      <FormInput
        label="Branch Name"
        placeholder="e.g. Westlands"
        value={branchName}
        onChange={setBranchName}
      />
    </Modal>
  );
}
