"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

import { logError } from "@/lib/logError";
import { IssuedCredentials } from "@/types/organizationInvitation";

/**
 * The one-time credentials display shared by InviteOrganizationMemberModal
 * (new invitation) and the Pending Invitations "Resend" action (credential
 * rotation) - both surface a server-generated temporary password exactly
 * once, since it's never retrievable again after this render.
 */
export default function IssuedCredentialsReveal({
  credentials,
}: {
  credentials: IssuedCredentials;
}) {
  const [copiedPassword, setCopiedPassword] = useState(false);

  const loginLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/login`
      : "";

  async function handleCopyPassword() {
    try {
      await navigator.clipboard.writeText(credentials.temporaryPassword);

      setCopiedPassword(true);
      toast.success("Temporary password copied.");
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch (error) {
      logError("[IssuedCredentialsReveal] Failed to copy password:", error);
      toast.error("Unable to copy password.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-sea-glass bg-porcelain p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-mineral">Login Email</span>
          <code className="text-sm text-graphite">{credentials.email}</code>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-mineral">Temporary Password</span>

          <div className="flex items-center gap-2">
            <code className="text-sm font-semibold text-graphite">
              {credentials.temporaryPassword}
            </code>

            <button
              type="button"
              onClick={handleCopyPassword}
              className="flex items-center gap-1.5 rounded-lg bg-eucalyptus px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-deep-eucalyptus"
            >
              {copiedPassword ? <Check size={13} /> : <Copy size={13} />}
              {copiedPassword ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-mineral">Login</span>
          <code className="truncate text-sm text-graphite">{loginLink}</code>
        </div>
      </div>

      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
        For security, this password will not be shown again after you close
        this window.
      </p>
    </div>
  );
}
