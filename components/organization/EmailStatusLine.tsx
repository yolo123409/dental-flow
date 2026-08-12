import { Check, TriangleAlert } from "lucide-react";

import { EmailDeliveryStatus } from "@/types/organizationInvitation";

/**
 * Shared by the invite/resend success panels and the Pending Invitations
 * table - the one place delivery status is rendered, so "sent" is never
 * claimed anywhere it isn't actually true (see lib/email/resend.ts).
 */
export default function EmailStatusLine({
  emailStatus,
  emailError,
  showCreated = true,
}: {
  emailStatus: EmailDeliveryStatus;
  emailError?: string | null;
  showCreated?: boolean;
}) {
  return (
    <div className="space-y-1 text-sm">
      {showCreated && (
        <p className="flex items-center gap-1.5 text-eucalyptus">
          <Check size={14} /> Invitation created
        </p>
      )}

      {emailStatus === "sent" && (
        <p className="flex items-center gap-1.5 text-eucalyptus">
          <Check size={14} /> Email sent
        </p>
      )}

      {emailStatus === "failed" && (
        <p className="flex items-center gap-1.5 text-amber-700">
          <TriangleAlert size={14} /> Email could not be sent
          {emailError ? ` (${emailError})` : ""}
        </p>
      )}

      {emailStatus === "not_configured" && (
        <p className="flex items-center gap-1.5 text-amber-700">
          <TriangleAlert size={14} /> Email delivery is not configured
        </p>
      )}
    </div>
  );
}
