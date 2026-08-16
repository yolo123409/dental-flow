"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import BranchMultiSelect from "./BranchMultiSelect";
import IssuedCredentialsReveal from "./IssuedCredentialsReveal";
import EmailStatusLine from "./EmailStatusLine";

import { createOrganizationInvitation } from "@/services/organizationInvitations";
import {
  getOrganizationBranches,
  OrganizationBranch,
} from "@/services/organizations";
import { logError } from "@/lib/logError";

import {
  CreateOrganizationInvitationResult,
  INVITABLE_ORGANIZATION_ROLES,
  InvitableOrganizationRole,
} from "@/types/organizationInvitation";
import { OrganizationBranchAccess } from "@/types/organization";

interface Props {
  open: boolean;
  organizationId: string;
  organizationName: string;
  initialRole?: InvitableOrganizationRole;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const ROLES = INVITABLE_ORGANIZATION_ROLES;

// Sourced from the same roles the invite RPC actually accepts
// (create_organization_invitation's p_role allow-list, migration 0047) - no
// new role vocabulary invented for this UI. Dentist/Receptionist grant
// exactly the same permissions as an independent clinic's own Dentist/
// Receptionist (lib/permissions.ts) - never Owner/Admin wildcard access.
const ROLE_DESCRIPTIONS: Record<InvitableOrganizationRole, string> = {
  Partner:
    "Organization-level access with restricted ownership controls.",
  Manager: "Can manage assigned branches according to organization permissions.",
  Viewer: "Read-only access where permitted.",
  Dentist: "Clinical access to assigned branch(es) - same permissions as a clinic-hired Dentist.",
  Receptionist:
    "Front-desk access to assigned branch(es) - same permissions as a clinic-hired Receptionist.",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteOrganizationMemberModal({
  open,
  organizationId,
  organizationName,
  initialRole = "Manager",
  onClose,
  onSuccess,
}: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] =
    useState<InvitableOrganizationRole>(initialRole);
  const [branchAccess, setBranchAccess] =
    useState<OrganizationBranchAccess>("all");

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CreateOrganizationInvitationResult | null>(
    null
  );
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!open) return;

    // Re-syncs to whichever role this open was launched with - useState's
    // initial value only applies on first mount, so callers that reuse one
    // long-lived modal instance for different quick actions (e.g. Overview
    // page's separate "Invite Manager"/"Invite Partner" buttons) need this
    // to actually change the preselected role on each open.
    setRole(initialRole);

    getOrganizationBranches(organizationId)
      .then(setBranches)
      .catch((error) => {
        logError(
          "[InviteOrganizationMemberModal] Failed to load branches:",
          error
        );
      });
  }, [open, organizationId, initialRole]);

  function reset() {
    setFullName("");
    setEmail("");
    setMessage("");
    setBranchAccess("all");
    setSelectedBranchIds([]);
    setResult(null);
    setCopiedLink(false);
  }

  function handleClose() {
    if (sending) return;

    reset();
    onClose();
  }

  async function handleSend() {
    if (!fullName.trim()) {
      toast.error("Please enter the invitee's full name.");
      return;
    }

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

      const branchNames =
        branchAccess === "selected"
          ? branches
              .filter((b) => selectedBranchIds.includes(b.id))
              .map((b) => b.name)
          : [];

      const created = await createOrganizationInvitation({
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        branchAccess,
        branchIds: selectedBranchIds,
        message: message.trim() || undefined,
        organizationName,
        branchNames,
      });

      setResult(created);

      if (created.emailStatus === "sent") {
        toast.success("Invitation created and email sent.");
      } else if (created.emailStatus === "not_configured") {
        toast.success("Invitation created. Email delivery is not configured.");
      } else {
        toast.error("Invitation created, but the email could not be sent.");
      }

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

  async function handleCopyLink() {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.link);

      setCopiedLink(true);

      toast.success("Link copied.");

      setTimeout(() => setCopiedLink(false), 2000);
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
      title={result ? "Invitation Ready" : "Invite Member"}
      onClose={handleClose}
      footer={
        result ? (
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
      {result?.mode === "new_account" ? (
        <div className="space-y-4">
          <EmailStatusLine
            emailStatus={result.emailStatus}
            emailError={result.emailError}
          />

          <p className="text-mineral">
            A DentalFlow account was created for <strong>{email}</strong> as{" "}
            <strong>{role}</strong>. They&apos;ll be required to set their
            own password the first time they sign in.
            {result.emailStatus !== "sent" &&
              " Share these credentials with them directly."}
          </p>

          <IssuedCredentialsReveal credentials={result.credentials} />
        </div>
      ) : result?.mode === "existing_account" ? (
        <div className="space-y-4">
          <EmailStatusLine
            emailStatus={result.emailStatus}
            emailError={result.emailError}
          />

          <p className="text-mineral">
            <strong>{email}</strong> already has a DentalFlow account.
            {result.emailStatus === "sent"
              ? " They've been emailed a link to sign in and join as "
              : " Share this link so they can sign in and join as "}
            <strong>{role}</strong>. It expires in 7 days.
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-sea-glass bg-porcelain p-3">
            <code className="flex-1 truncate text-sm text-graphite">
              {result.link}
            </code>

            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 rounded-lg bg-eucalyptus px-3 py-2 text-sm font-medium text-white transition hover:bg-deep-eucalyptus"
            >
              {copiedLink ? <Check size={15} /> : <Copy size={15} />}
              {copiedLink ? "Copied" : "Copy Link"}
            </button>
          </div>

          <p className="text-sm text-mineral">
            No new password was created - they&apos;ll continue using their
            existing DentalFlow credentials.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <FormInput
            label="Full Name"
            value={fullName}
            onChange={setFullName}
          />

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

            <p className="mt-1.5 text-xs text-mineral">
              {ROLE_DESCRIPTIONS[role]}
            </p>
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
            <BranchMultiSelect
              branches={branches}
              selectedBranchIds={selectedBranchIds}
              onChange={setSelectedBranchIds}
            />
          )}

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Optional Message
            </label>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Welcome to DentalFlow..."
              rows={3}
              className="w-full resize-none rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
