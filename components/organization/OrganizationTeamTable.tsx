"use client";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import { formatRelativeTime } from "@/lib/formatRelativeTime";

import { OrganizationUser } from "@/types/organization";
import { OrganizationInvitation } from "@/types/organizationInvitation";

interface Props {
  members: OrganizationUser[];
  invitations: OrganizationInvitation[];

  onEditMember: (member: OrganizationUser) => void;
  onRemoveMember: (organizationUserId: string) => void;
  onResendInvitation: (invitationId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
}

const ROLE_BADGE_CLASSES: Record<string, string> = {
  CEO: "bg-eucalyptus/10 text-deep-eucalyptus",
  Partner: "bg-blue-100 text-blue-700",
  Manager: "bg-amber-100 text-amber-700",
  Viewer: "bg-slate-100 text-slate-700",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        ROLE_BADGE_CLASSES[role] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {role}
    </span>
  );
}

function branchAccessLabel(branchAccess: string) {
  return branchAccess === "all" ? "All Branches" : "Selected Branches";
}

export default function OrganizationTeamTable({
  members,
  invitations,
  onEditMember,
  onRemoveMember,
  onResendInvitation,
  onCancelInvitation,
}: Props) {
  return (
    <div className="space-y-6">
      <Card title="Team Members">
        {members.length === 0 ? (
          <p className="py-8 text-center text-sm text-mineral">
            No team members yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-sea-glass text-left text-xs font-bold uppercase tracking-wide text-mineral">
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Branch Access</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>

              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-sea-glass last:border-0"
                  >
                    <td className="px-3 py-3 font-medium text-graphite">
                      {member.full_name}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {member.email}
                    </td>
                    <td className="px-3 py-3">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {branchAccessLabel(member.branch_access)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {member.role !== "CEO" && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onEditMember(member)}
                          >
                            Edit
                          </Button>

                          <Button
                            variant="danger"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onRemoveMember(member.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Branch Access</th>
                  <th className="px-3 py-3">Expires</th>
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
                      {invitation.email}
                    </td>
                    <td className="px-3 py-3">
                      <RoleBadge role={invitation.role} />
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {branchAccessLabel(invitation.branch_access)}
                    </td>
                    <td className="px-3 py-3 text-mineral">
                      {formatRelativeTime(invitation.expires_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() =>
                            onResendInvitation(invitation.id)
                          }
                        >
                          Resend
                        </Button>

                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          onClick={() =>
                            onCancelInvitation(invitation.id)
                          }
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
