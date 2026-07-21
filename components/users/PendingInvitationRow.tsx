"use client";

import { RefreshCw, X } from "lucide-react";

import Button from "@/components/ui/Button";
import RoleBadge from "@/components/ui/RoleBadge";

import { StaffInvitation } from "@/types/staffInvitation";

interface Props {
  invitation: StaffInvitation;
  onResend: (invitation: StaffInvitation) => void;
  onCancel: (invitation: StaffInvitation) => void;
  resending: boolean;
}

export default function PendingInvitationRow({
  invitation,
  onResend,
  onCancel,
  resending,
}: Props) {
  const expired =
    new Date(invitation.expires_at) < new Date();

  return (
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 sm:flex-row sm:items-center">
      <div>
        <p className="font-semibold text-slate-800">
          {invitation.full_name}
        </p>

        <p className="text-sm text-slate-500">
          {invitation.email}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <RoleBadge role={invitation.role} />

          <span
            className={`text-xs font-medium ${
              expired ? "text-red-500" : "text-slate-400"
            }`}
          >
            {expired
              ? "Expired"
              : `Expires ${new Date(
                  invitation.expires_at
                ).toLocaleDateString()}`}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => onResend(invitation)}
          disabled={resending}
        >
          <RefreshCw size={15} className="mr-1.5 inline" />
          Resend
        </Button>

        <Button
          variant="danger"
          onClick={() => onCancel(invitation)}
        >
          <X size={15} className="mr-1.5 inline" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
