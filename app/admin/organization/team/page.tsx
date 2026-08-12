"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import PageContainer from "@/components/ui/PageContainer";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import AccessDenied from "@/components/auth/AccessDenied";

import OrganizationTeamTable from "@/components/organization/OrganizationTeamTable";
import InviteOrganizationMemberModal from "@/components/organization/InviteOrganizationMemberModal";
import EditOrganizationMemberModal from "@/components/organization/EditOrganizationMemberModal";
import MemberDetailPanel from "@/components/organization/MemberDetailPanel";
import OrganizationAuditLogPanel from "@/components/organization/OrganizationAuditLogPanel";
import IssuedCredentialsReveal from "@/components/organization/IssuedCredentialsReveal";
import EmailStatusLine from "@/components/organization/EmailStatusLine";

import { useAuth } from "@/contexts/AuthContext";

import {
  switchActiveBranch,
  suspendOrganizationMember,
  reactivateOrganizationMember,
  removeOrganizationMember,
  getOrganizationBranches,
  getMyOrganization,
  OrganizationBranch,
} from "@/services/organizations";
import {
  getOrganizationTeamRoster,
  suspendClinicUserForOrganization,
  reactivateClinicUserForOrganization,
  removeClinicUserForOrganization,
} from "@/services/organizationTeam";
import {
  getPendingOrganizationInvitations,
  resendOrganizationInvitation,
  cancelOrganizationInvitation,
} from "@/services/organizationInvitations";

import { canAccessOrganization } from "@/lib/organizationPermissions";

import { OrganizationUser } from "@/types/organization";
import {
  EmailDeliveryStatus,
  IssuedCredentials,
  OrganizationInvitation,
} from "@/types/organizationInvitation";
import { OrganizationTeamMember } from "@/types/organizationTeam";

const PAGE_SIZE = 25;

type PendingAction = {
  type: "suspend" | "reactivate" | "remove";
  member: OrganizationTeamMember;
};

const ACTION_COPY: Record<
  PendingAction["type"],
  { title: string; confirmText: string; describe: (name: string) => string }
> = {
  suspend: {
    title: "Suspend access",
    confirmText: "Suspend",
    describe: (name) =>
      `Suspend ${name}? They will lose access immediately until reactivated.`,
  },
  reactivate: {
    title: "Reactivate access",
    confirmText: "Reactivate",
    describe: (name) => `Restore ${name}'s access?`,
  },
  remove: {
    title: "Remove member",
    confirmText: "Remove",
    describe: (name) =>
      `Remove ${name} from the organization? This cannot be undone from here.`,
  },
};

export default function OrganizationTeamPage() {
  const { organizationUser, loading: authLoading } = useAuth();

  const [members, setMembers] = useState<OrganizationTeamMember[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [organizationName, setOrganizationName] = useState("");

  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);

  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<OrganizationUser | null>(
    null
  );
  const [detailMember, setDetailMember] =
    useState<OrganizationTeamMember | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [rotatedCredentials, setRotatedCredentials] = useState<{
    credentials: IssuedCredentials;
    emailStatus: EmailDeliveryStatus;
    emailError?: string;
  } | null>(null);

  const canView = organizationUser
    ? canAccessOrganization(organizationUser.role, "view_team")
    : false;

  const loadRoster = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const { members: rows, totalCount: count } =
        await getOrganizationTeamRoster(organizationUser.organization_id, {
          search,
          role: roleFilter || undefined,
          status: statusFilter || undefined,
          branchId: branchFilter || undefined,
          limit: PAGE_SIZE,
          offset,
        });

      setMembers(rows);
      setTotalCount(count);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load your organization's team."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationUser, search, roleFilter, statusFilter, branchFilter, offset]);

  const loadInvitations = useCallback(async () => {
    try {
      const rows = await getPendingOrganizationInvitations();
      setInvitations(rows);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load pending invitations."
      );
    }
  }, []);

  useEffect(() => {
    if (canView) {
      loadRoster();
    } else {
      setLoading(false);
    }
  }, [canView, loadRoster]);

  useEffect(() => {
    if (canView) {
      loadInvitations();
    }
  }, [canView, loadInvitations]);

  useEffect(() => {
    if (!canView || !organizationUser) return;

    getOrganizationBranches(organizationUser.organization_id)
      .then(setBranches)
      .catch((error) => console.error(error));

    getMyOrganization(organizationUser.organization_id)
      .then((org) => setOrganizationName(org?.name ?? ""))
      .catch((error) => console.error(error));
  }, [canView, organizationUser]);

  // Debounces the raw keystrokes into `search` (300ms, matching this
  // codebase's other server-side search inputs, e.g. OrganizationSearch)
  // so every keystroke doesn't fire its own roster RPC call.
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // Any filter change resets to the first page - a stale offset past the
  // end of a newly-filtered result set would just render an empty page.
  useEffect(() => {
    setOffset(0);
  }, [search, roleFilter, statusFilter, branchFilter]);

  async function handleSwitchBranch(clinicId: string) {
    try {
      await switchActiveBranch(clinicId);
      window.location.href = "/admin";
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error ? error.message : "Unable to switch branch."
      );
    }
  }

  async function handleConfirmAction() {
    if (!pendingAction) return;

    const { type, member } = pendingAction;

    try {
      setActionLoading(true);

      if (member.source === "organization" && member.organization_user_id) {
        const id = member.organization_user_id;

        if (type === "suspend") await suspendOrganizationMember(id);
        else if (type === "reactivate") await reactivateOrganizationMember(id);
        else await removeOrganizationMember(id);
      } else if (member.source === "clinic" && member.clinic_user_id) {
        const id = member.clinic_user_id;

        if (type === "suspend") await suspendClinicUserForOrganization(id);
        else if (type === "reactivate")
          await reactivateClinicUserForOrganization(id);
        else await removeClinicUserForOrganization(id);
      }

      toast.success(`${ACTION_COPY[type].confirmText}d.`);

      setPendingAction(null);

      await loadRoster();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error ? error.message : "Unable to complete this action."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResendInvitation(invitation: OrganizationInvitation) {
    try {
      const result = await resendOrganizationInvitation(
        invitation,
        organizationName
      );

      if (result.mode === "new_account") {
        // The rotated temporary password is only ever in this one
        // response - show it once rather than just toasting success.
        setRotatedCredentials({
          credentials: result.credentials,
          emailStatus: result.emailStatus,
          emailError: result.emailError,
        });
      } else if (result.emailStatus === "sent") {
        toast.success("Invitation email resent.");
      } else if (result.emailStatus === "not_configured") {
        toast.success(
          "Invitation link refreshed. Email delivery is not configured."
        );
      } else {
        toast.error("Invitation link refreshed, but the email could not be sent.");
      }

      await loadInvitations();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error ? error.message : "Unable to resend invitation."
      );
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!confirm("Cancel this invitation?")) return;

    try {
      await cancelOrganizationInvitation(invitationId);

      toast.success("Invitation cancelled.");

      await loadInvitations();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error ? error.message : "Unable to cancel invitation."
      );
    }
  }

  function handleEditMember(member: OrganizationTeamMember) {
    if (member.source !== "organization" || !member.organization_user_id) {
      return;
    }

    setEditingMember({
      id: member.organization_user_id,
      organization_id: organizationUser!.organization_id,
      user_id: "",
      full_name: member.full_name,
      email: member.email,
      role: member.role as OrganizationUser["role"],
      branch_access: member.branch_scope === "all" ? "all" : "selected",
      status: member.status as OrganizationUser["status"],
      invited_by: null,
      created_at: member.created_at,
      updated_at: member.created_at,
    });
  }

  if (authLoading || loading) {
    return (
      <PageContainer>
        <LoadingSpinner text="Loading team..." />
      </PageContainer>
    );
  }

  if (!canView || !organizationUser) {
    return (
      <PageContainer>
        <AccessDenied />
      </PageContainer>
    );
  }

  const hasNext = offset + PAGE_SIZE < totalCount;
  const hasPrev = offset > 0;

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Team &amp; Access</h1>

          <p className="mt-2 text-mineral">
            Manage organization-wide members and locally-hired branch staff
            from one place.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAuditLogOpen(true)}>
            Audit Log
          </Button>

          <Button onClick={() => setInviteOpen(true)}>Invite Member</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, email, or branch..."
          className="min-h-10 flex-1 rounded-lg border border-sea-glass bg-enamel px-3 py-2 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
        />

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="min-h-10 rounded-lg border border-sea-glass bg-enamel px-3 py-2 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
        >
          <option value="">All Roles</option>
          <option value="CEO">CEO</option>
          <option value="Partner">Partner</option>
          <option value="Manager">Manager</option>
          <option value="Viewer">Viewer</option>
          <option value="Owner">Owner</option>
          <option value="Admin">Admin</option>
          <option value="Dentist">Dentist</option>
          <option value="Receptionist">Receptionist</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-10 rounded-lg border border-sea-glass bg-enamel px-3 py-2 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
        >
          <option value="">Active &amp; Suspended</option>
          <option value="Active">Active</option>
          <option value="Suspended">Suspended</option>
          <option value="Removed">Removed</option>
        </select>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="min-h-10 rounded-lg border border-sea-glass bg-enamel px-3 py-2 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
        >
          <option value="">All Branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </div>

      <OrganizationTeamTable
        members={members}
        invitations={invitations}
        onRowClick={setDetailMember}
        onEditMember={handleEditMember}
        onSuspendMember={(member) =>
          setPendingAction({ type: "suspend", member })
        }
        onReactivateMember={(member) =>
          setPendingAction({ type: "reactivate", member })
        }
        onRemoveMember={(member) =>
          setPendingAction({ type: "remove", member })
        }
        onSwitchBranch={handleSwitchBranch}
        onResendInvitation={handleResendInvitation}
        onCancelInvitation={handleCancelInvitation}
      />

      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!hasPrev}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          >
            Previous
          </Button>

          <span className="text-xs text-mineral">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of{" "}
            {totalCount}
          </span>

          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!hasNext}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      )}

      <InviteOrganizationMemberModal
        open={inviteOpen}
        organizationId={organizationUser.organization_id}
        organizationName={organizationName}
        onClose={() => setInviteOpen(false)}
        onSuccess={async () => {
          await Promise.all([loadRoster(), loadInvitations()]);
        }}
      />

      <EditOrganizationMemberModal
        open={editingMember !== null}
        organizationId={organizationUser.organization_id}
        member={editingMember}
        onClose={() => setEditingMember(null)}
        onSuccess={loadRoster}
      />

      <MemberDetailPanel
        organizationId={organizationUser.organization_id}
        organizationName={organizationName}
        member={detailMember}
        onClose={() => setDetailMember(null)}
        onEdit={(member) => {
          setDetailMember(null);
          handleEditMember(member);
        }}
        onSuspend={(member) => {
          setDetailMember(null);
          setPendingAction({ type: "suspend", member });
        }}
        onReactivate={(member) => {
          setDetailMember(null);
          setPendingAction({ type: "reactivate", member });
        }}
        onRemove={(member) => {
          setDetailMember(null);
          setPendingAction({ type: "remove", member });
        }}
      />

      <OrganizationAuditLogPanel
        organizationId={organizationUser.organization_id}
        open={auditLogOpen}
        onClose={() => setAuditLogOpen(false)}
      />

      <Modal
        open={rotatedCredentials !== null}
        title="New Temporary Credentials"
        onClose={() => setRotatedCredentials(null)}
        footer={
          <Button onClick={() => setRotatedCredentials(null)}>Done</Button>
        }
      >
        {rotatedCredentials && (
          <div className="space-y-4">
            <EmailStatusLine
              emailStatus={rotatedCredentials.emailStatus}
              emailError={rotatedCredentials.emailError}
              showCreated={false}
            />

            <p className="text-mineral">
              The previous temporary password no longer works.
              {rotatedCredentials.emailStatus !== "sent" &&
                " Share these new credentials directly."}
            </p>

            <IssuedCredentialsReveal
              credentials={rotatedCredentials.credentials}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction ? ACTION_COPY[pendingAction.type].title : ""}
        description={
          pendingAction
            ? ACTION_COPY[pendingAction.type].describe(
                pendingAction.member.full_name
              )
            : undefined
        }
        confirmText={pendingAction ? ACTION_COPY[pendingAction.type].confirmText : undefined}
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={handleConfirmAction}
      />
    </PageContainer>
  );
}
