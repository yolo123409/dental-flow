"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import RoleBadge from "@/components/ui/RoleBadge";
import StatusBadge from "@/components/ui/StatusBadge";
import Avatar from "@/components/ui/Avatar";

import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { logError } from "@/lib/logError";

import EmailStatusLine from "./EmailStatusLine";

import { OrganizationTeamMember } from "@/types/organizationTeam";
import { OrganizationInvitation } from "@/types/organizationInvitation";

interface Props {
  members: OrganizationTeamMember[];
  invitations: OrganizationInvitation[];

  onRowClick: (member: OrganizationTeamMember) => void;
  onEditMember: (member: OrganizationTeamMember) => void;
  onSuspendMember: (member: OrganizationTeamMember) => void;
  onReactivateMember: (member: OrganizationTeamMember) => void;
  onRemoveMember: (member: OrganizationTeamMember) => void;
  onSwitchBranch: (clinicId: string) => void;

  onResendInvitation: (invitation: OrganizationInvitation) => void;
  onCancelInvitation: (invitationId: string) => void;
}

// Org-level roles (CEO/Partner/Manager/Viewer) aren't covered by
// components/ui/RoleBadge.tsx (which handles the clinic-level vocabulary:
// Owner/Admin/Dentist/Receptionist) - a small local map for those instead,
// same color language as the rest of the org UI.
const ORG_ROLE_BADGE_CLASSES: Record<string, string> = {
  CEO: "bg-eucalyptus/10 text-deep-eucalyptus",
  Partner: "bg-blue-100 text-blue-700",
  Manager: "bg-amber-100 text-amber-700",
  Viewer: "bg-slate-100 text-slate-700",
};

function MemberRoleBadge({ member }: { member: OrganizationTeamMember }) {
  // Dentist/Receptionist is the same permission vocabulary regardless of
  // source (organization-invited-but-not-yet-switched, or clinic-hired) -
  // RoleBadge already has the right colors for it, no separate org-side
  // color needed (migration 0047).
  if (member.source === "clinic" || member.role === "Dentist" || member.role === "Receptionist") {
    return <RoleBadge role={member.role} />;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        ORG_ROLE_BADGE_CLASSES[member.role] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {member.role}
    </span>
  );
}

function branchAccessLabel(member: OrganizationTeamMember) {
  if (member.branch_scope === "all") return "All Branches";
  if (member.branch_scope === "single") return member.branch_names[0] ?? "—";
  return `${member.branch_names.length} ${
    member.branch_names.length === 1 ? "Branch" : "Branches"
  }`;
}

function BranchChips({
  member,
  onSwitchBranch,
}: {
  member: OrganizationTeamMember;
  onSwitchBranch: (clinicId: string) => void;
}) {
  if (member.branch_names.length === 0) {
    return <span className="text-mineral">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {member.branch_ids.map((clinicId, index) => (
        <button
          key={clinicId}
          type="button"
          onClick={() => onSwitchBranch(clinicId)}
          className="rounded-full bg-porcelain px-2.5 py-1 text-xs font-medium text-graphite transition hover:bg-sea-glass"
        >
          {member.branch_names[index]}
        </button>
      ))}
    </div>
  );
}

function MemberActions({
  member,
  onEditMember,
  onSuspendMember,
  onReactivateMember,
  onRemoveMember,
}: {
  member: OrganizationTeamMember;
  onEditMember: (member: OrganizationTeamMember) => void;
  onSuspendMember: (member: OrganizationTeamMember) => void;
  onReactivateMember: (member: OrganizationTeamMember) => void;
  onRemoveMember: (member: OrganizationTeamMember) => void;
}) {
  // The CEO row gets no actions at all - unchanged from before this page
  // had suspend/reactivate.
  if (member.source === "organization" && member.role === "CEO") {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {member.source === "organization" && (
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onEditMember(member);
          }}
        >
          Edit
        </Button>
      )}

      {member.status === "Suspended" ? (
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onReactivateMember(member);
          }}
        >
          Reactivate
        </Button>
      ) : (
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onSuspendMember(member);
          }}
        >
          Suspend
        </Button>
      )}

      <Button
        variant="danger"
        className="px-3 py-1.5 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          onRemoveMember(member);
        }}
      >
        Remove
      </Button>
    </div>
  );
}

export default function OrganizationTeamTable({
  members,
  invitations,
  onRowClick,
  onEditMember,
  onSuspendMember,
  onReactivateMember,
  onRemoveMember,
  onSwitchBranch,
  onResendInvitation,
  onCancelInvitation,
}: Props) {
  return (
    <div className="space-y-6">
      <Card title="Team Members" className="overflow-hidden">
        {members.length === 0 ? (
          <p className="py-8 text-center text-sm text-mineral">
            No team members match your filters.
          </p>
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-sea-glass text-left text-xs font-bold uppercase tracking-wide text-mineral">
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Branches</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Last Active</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>

                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.member_key}
                      onClick={() => onRowClick(member)}
                      className="cursor-pointer border-b border-sea-glass last:border-0 hover:bg-porcelain"
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={member.full_name} size="sm" />
                          <div>
                            <p className="font-medium text-graphite">
                              {member.full_name}
                            </p>
                            <p className="text-xs text-mineral">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <MemberRoleBadge member={member} />
                      </td>
                      <td className="px-3 py-3">
                        <BranchChips
                          member={member}
                          onSwitchBranch={onSwitchBranch}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={member.status} />
                      </td>
                      <td className="px-3 py-3 text-mineral">
                        {/* No last-active tracking exists anywhere in this
                            codebase yet (clinic_users.last_login is declared
                            but never written) - an honest placeholder, not
                            faked. */}
                        Not tracked yet
                      </td>
                      <td className="px-3 py-3 text-right">
                        <MemberActions
                          member={member}
                          onEditMember={onEditMember}
                          onSuspendMember={onSuspendMember}
                          onReactivateMember={onReactivateMember}
                          onRemoveMember={onRemoveMember}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tablet/mobile: cards */}
            <div className="space-y-3 md:hidden">
              {members.map((member) => (
                <div
                  key={member.member_key}
                  onClick={() => onRowClick(member)}
                  className="cursor-pointer rounded-lg border border-sea-glass p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.full_name} size="sm" />
                      <div>
                        <p className="font-medium text-graphite">
                          {member.full_name}
                        </p>
                        <p className="text-xs text-mineral">{member.email}</p>
                      </div>
                    </div>
                    <StatusBadge status={member.status} />
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <MemberRoleBadge member={member} />
                    <span className="text-xs text-mineral">
                      {branchAccessLabel(member)}
                    </span>
                  </div>

                  <div className="mt-3">
                    <BranchChips
                      member={member}
                      onSwitchBranch={onSwitchBranch}
                    />
                  </div>

                  <p className="mt-2 text-xs text-mineral">
                    Last active: Not tracked yet
                  </p>

                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <MemberActions
                      member={member}
                      onEditMember={onEditMember}
                      onSuspendMember={onSuspendMember}
                      onReactivateMember={onReactivateMember}
                      onRemoveMember={onRemoveMember}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card title="Pending Invitations">
        {invitations.length === 0 ? (
          <p className="py-8 text-center text-sm text-mineral">
            No pending invitations.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-sea-glass text-left text-xs font-bold uppercase tracking-wide text-mineral">
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Branches</th>
                  <th className="px-3 py-3">Invited By</th>
                  <th className="px-3 py-3">Sent</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>

              <tbody>
                {invitations.map((invitation) => (
                  <tr
                    key={invitation.id}
                    className="border-b border-sea-glass last:border-0"
                  >
                    <td className="px-3 py-3 font-medium text-graphite">
                      {invitation.full_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {invitation.email}
                    </td>
                    <td className="px-3 py-3">
                      {invitation.role === "Dentist" || invitation.role === "Receptionist" ? (
                        <RoleBadge role={invitation.role} />
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            ORG_ROLE_BADGE_CLASSES[invitation.role] ??
                            "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {invitation.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {invitation.branch_access === "all"
                        ? "All Branches"
                        : invitation.branch_names.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {invitation.invited_by_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {formatRelativeTime(invitation.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        {invitation.is_expired ? (
                          <Badge color="red">Expired</Badge>
                        ) : (
                          <Badge color="yellow">Pending</Badge>
                        )}

                        <p className="text-xs text-mineral">
                          {invitation.credentials_issued
                            ? "Credentials issued - awaiting first login"
                            : "Awaiting sign-in"}
                        </p>

                        <EmailStatusLine
                          emailStatus={invitation.email_status}
                          emailError={invitation.email_error}
                          showCreated={false}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <CopyInvitationLinkButton token={invitation.token} />

                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => onResendInvitation(invitation)}
                        >
                          Resend
                        </Button>

                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => onCancelInvitation(invitation.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CopyInvitationLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";

      await navigator.clipboard.writeText(`${origin}/org-invite/${token}`);

      setCopied(true);
      toast.success("Invitation link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logError("[OrganizationTeamTable] Failed to copy invitation link:", error);
      toast.error("Unable to copy link.");
    }
  }

  return (
    <Button
      variant="secondary"
      className="px-3 py-1.5 text-xs"
      onClick={handleCopy}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy Link"}
    </Button>
  );
}
