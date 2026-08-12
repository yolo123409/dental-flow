"use client";

import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Avatar from "@/components/ui/Avatar";
import RoleBadge from "@/components/ui/RoleBadge";
import StatusBadge from "@/components/ui/StatusBadge";
import Badge from "@/components/ui/Badge";

import { getOrganizationAuditLog } from "@/services/organizationAuditLog";
import { logError } from "@/lib/logError";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import { OrganizationTeamMember } from "@/types/organizationTeam";
import {
  OrganizationAuditLogEntry,
  AUDIT_ACTION_LABELS,
} from "@/types/organizationAuditLog";

interface Props {
  organizationId: string;
  organizationName: string;
  member: OrganizationTeamMember | null;
  onClose: () => void;
  onEdit: (member: OrganizationTeamMember) => void;
  onSuspend: (member: OrganizationTeamMember) => void;
  onReactivate: (member: OrganizationTeamMember) => void;
  onRemove: (member: OrganizationTeamMember) => void;
}

export default function MemberDetailPanel({
  organizationId,
  organizationName,
  member,
  onClose,
  onEdit,
  onSuspend,
  onReactivate,
  onRemove,
}: Props) {
  const [recentActivity, setRecentActivity] = useState<
    OrganizationAuditLogEntry[]
  >([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  useEffect(() => {
    if (!member) return;

    const targetId = member.organization_user_id ?? member.clinic_user_id;

    if (!targetId) return;

    setLoadingActivity(true);

    getOrganizationAuditLog(organizationId, { targetId, limit: 5 })
      .then(({ entries }) => setRecentActivity(entries))
      .catch((error) => {
        logError("[MemberDetailPanel] Failed to load recent activity:", error);
        setRecentActivity([]);
      })
      .finally(() => setLoadingActivity(false));
  }, [organizationId, member]);

  if (!member) return null;

  return (
    <Modal open={member !== null} title="Member Details" onClose={onClose}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={member.full_name} size="lg" />
          <div>
            <p className="text-lg font-bold text-graphite">
              {member.full_name}
            </p>
            <p className="text-sm text-mineral">{member.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Role
            </p>
            <div className="mt-1">
              <RoleBadge role={member.role} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Status
            </p>
            <div className="mt-1">
              <StatusBadge status={member.status} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Organization
            </p>
            <p className="mt-1 text-graphite">{organizationName || "—"}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Joined Date
            </p>
            <p className="mt-1 text-graphite">
              {new Date(member.created_at).toLocaleDateString()}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Invited By
            </p>
            <p className="mt-1 text-graphite">
              {member.invited_by_name ?? "Not tracked"}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Last Active
            </p>
            {/* Deliberately a static placeholder, not faked - no
                last-active tracking exists anywhere in this codebase
                (clinic_users.last_login is declared but never written by
                anything). Building real tracking is out of scope for this
                phase. */}
            <p className="mt-1 text-graphite">Not tracked yet</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mineral">
            Branch Access
          </p>

          {member.branch_scope === "all" ? (
            <p className="text-sm font-medium text-graphite">
              All {member.branch_names.length}{" "}
              {member.branch_names.length === 1 ? "Branch" : "Branches"}
            </p>
          ) : member.branch_names.length === 0 ? (
            <p className="text-sm text-mineral">No branch access.</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-graphite">
                {member.branch_names.length}{" "}
                {member.branch_names.length === 1 ? "branch" : "branches"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {member.branch_names.map((name) => (
                  <Badge key={name} color="gray">
                    {name}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mineral">
            Recent Activity
          </p>

          {loadingActivity ? (
            <p className="text-sm text-mineral">Loading...</p>
          ) : recentActivity.length === 0 ? (
            <p className="text-sm text-mineral">No recorded activity yet.</p>
          ) : (
            <div className="space-y-2">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="text-sm">
                  <span className="font-medium text-graphite">
                    {entry.actor_full_name}
                  </span>{" "}
                  <span className="text-mineral">
                    {AUDIT_ACTION_LABELS[entry.action]}
                  </span>{" "}
                  <span className="text-xs text-mineral">
                    · {formatRelativeTime(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-sea-glass pt-4">
          {member.source === "organization" && member.role === "CEO" ? (
            <p className="text-sm text-mineral">
              Ownership transfer is managed separately.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {member.source === "organization" && (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => onEdit(member)}
                >
                  Edit Access
                </Button>
              )}

              {member.status === "Suspended" ? (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => onReactivate(member)}
                >
                  Reactivate
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => onSuspend(member)}
                >
                  Suspend
                </Button>
              )}

              <Button
                variant="danger"
                className="px-3 py-1.5 text-xs"
                onClick={() => onRemove(member)}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
