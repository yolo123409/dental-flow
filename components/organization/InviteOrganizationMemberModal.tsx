"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { createOrganizationInvitation } from "@/services/organizationInvitations";
import {
  getOrganizationBranches,
  OrganizationBranch,
} from "@/services/organizations";
import { logError } from "@/lib/logError";

import {
  InvitableOrganizationRole,
} from "@/types/organizationInvitation";
import { OrganizationBranchAccess } from "@/types/organization";

interface Props {
  open: boolean;
  organizationId: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const ROLES: InvitableOrganizationRole[] = [
  "Partner",
  "Manager",
  "Viewer",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteOrganizationMemberModal({
  open,
  organizationId,
  onClose,
  onSuccess,
}: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] =
    useState<InvitableOrganizationRole>("Manager");
  const [branchAccess, setBranchAccess] =
    useState<OrganizationBranchAccess>("all");

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const [sending, setSending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    getOrganizationBranches(organizationId)
      .then(setBranches)
      .catch((error) => {
        logError(
          "[InviteOrganizationMemberModal] Failed to load branches:",
          error
        );
      });
  }, [open, organizationId]);

  function reset() {
    setEmail("");
    setRole("Manager");
    setBranchAccess("all");
    setSelectedBranchIds([]);
    setInviteLink(null);
    setCopied(false);
  }

  function handleClose() {
    if (sending) return;

    reset();
    onClose();
  }

  function toggleBranch(clinicId: string) {
    setSelectedBranchIds((prev) =>
      prev.includes(clinicId)
        ? prev.filter((id) => id !== clinicId)
        : [...prev, clinicId]
    );
  }

  async function handleSend() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }

    if (branchAccess === "selected" && selectedBranchIds.length === 0) {
      toast.error("Select at least one branch.");
      return;
    }

    try {
      setSending(true);

      const { link } = await createOrganizationInvitation({
        email: email.trim(),
        role,
        branchAccess,
        branchIds: selectedBranchIds,
      });

      setInviteLink(link);

      toast.success("Invitation created.");

      await onSuccess();
    } catch (error) {
      logError(
        "[InviteOrganizationMemberModal] createOrganizationInvitation failed:",
        error
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create invitation."
      );
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);

      setCopied(true);

      toast.success("Link copied.");

      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logError(
        "[InviteOrganizationMemberModal] Failed to copy link:",
        error
      );

      toast.error("Unable to copy link.");
    }
  }

  return (
    <Modal
      open={open}
      title={inviteLink ? "Invitation Ready" : "Invite Member"}
      onClose={handleClose}
      footer={
        inviteLink ? (
          <Button onClick={handleClose}>Done</Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={handleClose}
              disabled={sending}
            >
              Cancel
            </Button>

            <Button onClick={handleSend} disabled={sending}>
              {sending ? "Sending..." : "Send Invitation"}
            </Button>
          </>
        )
      }
    >
      {inviteLink ? (
        <div className="space-y-4">
          <p className="text-mineral">
            Share this link with <strong>{email}</strong> so they can
            create their own DentalFlow account and join as{" "}
            <strong>{role}</strong>. It expires in 7 days.
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-sea-glass bg-porcelain p-3">
            <code className="flex-1 truncate text-sm text-graphite">
              {inviteLink}
            </code>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg bg-eucalyptus px-3 py-2 text-sm font-medium text-white transition hover:bg-deep-eucalyptus"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy Link"}
            </button>
          </div>

          <p className="text-sm text-mineral">
            Email delivery isn&apos;t connected yet, so share this link
            directly for now.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <FormInput
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
          />

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
