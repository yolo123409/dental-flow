"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import {
  getOrganizationBranches,
  getOrganizationUserBranches,
  updateOrganizationMember,
  OrganizationBranch,
} from "@/services/organizations";
import { logError } from "@/lib/logError";

import { InvitableOrganizationRole } from "@/types/organizationInvitation";
import { OrganizationBranchAccess, OrganizationUser } from "@/types/organization";

interface Props {
  open: boolean;
  organizationId: string;
  member: OrganizationUser | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const ROLES: InvitableOrganizationRole[] = [
  "Partner",
  "Manager",
  "Viewer",
];

export default function EditOrganizationMemberModal({
  open,
  organizationId,
  member,
  onClose,
  onSuccess,
}: Props) {
  const [role, setRole] =
    useState<InvitableOrganizationRole>("Manager");
  const [branchAccess, setBranchAccess] =
    useState<OrganizationBranchAccess>("all");

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !member) return;

    setRole(member.role as InvitableOrganizationRole);
    setBranchAccess(member.branch_access);

    setLoading(true);

    Promise.all([
      getOrganizationBranches(organizationId),
      getOrganizationUserBranches(member.id),
    ])
      .then(([branchRows, currentBranchIds]) => {
        setBranches(branchRows);
        setSelectedBranchIds(currentBranchIds);
      })
      .catch((error) => {
        logError(
          "[EditOrganizationMemberModal] Failed to load branches:",
          error
        );

        toast.error("Failed to load branch details.");
      })
      .finally(() => setLoading(false));
  }, [open, member, organizationId]);

  function toggleBranch(clinicId: string) {
    setSelectedBranchIds((prev) =>
      prev.includes(clinicId)
        ? prev.filter((id) => id !== clinicId)
        : [...prev, clinicId]
    );
  }

  function handleClose() {
    if (saving) return;

    onClose();
  }

  async function handleSave() {
    if (!member) return;

    if (branchAccess === "selected" && selectedBranchIds.length === 0) {
      toast.error("Select at least one branch.");
      return;
    }

    try {
      setSaving(true);

      await updateOrganizationMember(member.id, {
        role,
        branchAccess,
        branchIds: selectedBranchIds,
      });

      toast.success("Member updated.");

      onClose();

      await onSuccess();
    } catch (error) {
      logError(
        "[EditOrganizationMemberModal] updateOrganizationMember failed:",
        error
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update member."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  return (
    <Modal
      open={open}
      title={`Edit ${member.full_name}`}
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

          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-mineral">
          Loading...
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Role
            </label>

            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as InvitableOrganizationRole)
              }
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Branch Access
            </label>

            <div className="flex gap-3">
              <Button
                variant={branchAccess === "all" ? "primary" : "secondary"}
                className="flex-1"
                onClick={() => setBranchAccess("all")}
              >
                All Branches
              </Button>

              <Button
                variant={
                  branchAccess === "selected" ? "primary" : "secondary"
                }
                className="flex-1"
                onClick={() => setBranchAccess("selected")}
              >
                Selected Branches
              </Button>
            </div>
          </div>

          {branchAccess === "selected" && (
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-sea-glass p-3">
              {branches.length === 0 ? (
                <p className="text-sm text-mineral">
                  No branches yet.
                </p>
              ) : (
                branches.map((branch) => (
                  <label
                    key={branch.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-graphite hover:bg-porcelain"
                  >
                    <input
                      type="checkbox"
                      checked={selectedBranchIds.includes(branch.id)}
                      onChange={() => toggleBranch(branch.id)}
                      className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
                    />
                    {branch.name}
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
