"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { createInvitation } from "@/services/staffInvitations";
import { INVITABLE_ROLES, InvitableRole } from "@/lib/permissions";
import { getSafeErrorMessage, logError } from "@/lib/logError";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteStaffModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("Receptionist");

  const [sending, setSending] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(
    null
  );
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  function reset() {
    setFullName("");
    setEmail("");
    setRole("Receptionist");
    setInviteLink(null);
    setEmailSent(false);
    setCopied(false);
  }

  function handleClose() {
    if (sending) return;

    reset();
    onClose();
  }

  async function handleSend() {
    if (!fullName.trim()) {
      toast.error("Full name is required.");
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }

    try {
      setSending(true);

      const { link, emailSent } = await createInvitation({
        full_name: fullName.trim(),
        email: email.trim(),
        role,
      });

      setInviteLink(link);
      setEmailSent(emailSent);

      toast.success(
        emailSent
          ? "Invitation sent successfully."
          : "Invitation created, but the email could not be sent. You can copy the invitation link and send it manually."
      );

      await onSuccess();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Unable to create invitation.",
          "[InviteStaffModal] createInvitation failed:"
        )
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
      logError("[InviteStaffModal] Failed to copy link:", error);

      toast.error("Unable to copy link.");
    }
  }

  return (
    <Modal
      open={open}
      title={inviteLink ? "Invitation Ready" : "Invite Staff"}
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
          <p className="text-slate-600">
            {emailSent ? (
              <>
                An email was sent to <strong>{email}</strong>
              </>
            ) : (
              <>
                Share this link with <strong>{fullName}</strong>
              </>
            )}{" "}
            so they can set a password and join as{" "}
            <strong>{role}</strong>. It expires in 7 days.
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
            <code className="flex-1 truncate text-sm text-slate-700">
              {inviteLink}
            </code>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              {copied ? (
                <Check size={15} />
              ) : (
                <Copy size={15} />
              )}
              {copied ? "Copied" : "Copy Link"}
            </button>
          </div>

          <p
            className={`text-sm ${
              emailSent ? "text-slate-400" : "text-amber-600"
            }`}
          >
            {emailSent
              ? "You can also copy the link above and share it directly."
              : "The invitation email could not be sent. Copy the link above and send it manually."}
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
            <label className="mb-2 block font-medium">
              Role
            </label>

            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as InvitableRole)
              }
              className="w-full rounded-xl border border-slate-300 p-3"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}
