"use client";

import { useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

import { createBranch } from "@/services/organizations";
import { logError } from "@/lib/logError";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CreateBranchModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [branchName, setBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  function handleClose() {
    if (creating) return;

    setBranchName("");
    onClose();
  }

  async function handleCreate() {
    if (creating) return;

    if (!branchName.trim()) {
      toast.error("Please enter a branch name.");
      return;
    }

    try {
      setCreating(true);

      await createBranch(branchName.trim());

      toast.success("Branch created.");

      setBranchName("");

      await onSuccess();

      onClose();
    } catch (error) {
      logError("[CreateBranchModal] Failed to create branch:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create branch."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Create Branch"
      onClose={handleClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={creating}
          >
            Cancel
          </Button>

          <Button
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create Branch"}
          </Button>
        </>
      }
    >
      <div>
        <label className="mb-2 block text-sm font-semibold text-graphite">
          Branch name
        </label>

        <p className="mb-3 text-sm text-mineral">
          A new branch is created with the same default roles as any
          Dental Flow clinic - Owner, Admin, Dentist and Receptionist -
          and you become its Owner immediately.
        </p>

        <Input
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="e.g. Westlands Branch"
          autoFocus
        />
      </div>
    </Modal>
  );
}
