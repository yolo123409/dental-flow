"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import CeoGuard from "@/components/auth/CeoGuard";
import useOrganization from "@/hooks/useOrganization";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import RoleBadge from "@/components/ui/RoleBadge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import InviteToBranchModal from "@/components/organization/InviteToBranchModal";

import {
  getOrganizationBranches,
  getOrganizationInvitations,
} from "@/services/organizations";
import { cancelInvitation } from "@/services/staffInvitations";
import { logError } from "@/lib/logError";

import {
  OrganizationBranch,
  OrganizationInvitation,
} from "@/types/organization";

type InvitationStatus = "Pending" | "Accepted" | "Expired";

function invitationStatus(
  invitation: OrganizationInvitation
): InvitationStatus {
  if (invitation.accepted_at) return "Accepted";

  if (new Date(invitation.expires_at) < new Date()) return "Expired";

  return "Pending";
}

function StatusPill({ status }: { status: InvitationStatus }) {
  if (status === "Accepted") return <Badge color="green">Accepted</Badge>;

  if (status === "Expired") return <Badge color="gray">Expired</Badge>;

  return <Badge color="yellow">Pending</Badge>;
}

function InvitationsPageContent() {
  const { organizationUser } = useOrganization();

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  const [showInviteModal, setShowInviteModal] = useState(false);

  const [cancelTarget, setCancelTarget] =
    useState<OrganizationInvitation | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const loadAll = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const [branchList, invitationList] = await Promise.all([
        getOrganizationBranches(organizationUser.organization_id),
        getOrganizationInvitations(organizationUser.organization_id),
      ]);

      setBranches(branchList);
      setInvitations(invitationList);
    } catch (error) {
      logError(
        "[Organization invitations page] Failed to load invitations:",
        error
      );

      toast.error("Unable to load invitations.");
    } finally {
      setLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function confirmCancel() {
    if (!cancelTarget) return;

    try {
      setCancelling(true);

      await cancelInvitation(cancelTarget.id);

      toast.success("Invitation cancelled.");

      setCancelTarget(null);

      await loadAll();
    } catch (error) {
      logError(
        "[Organization invitations page] Failed to cancel invitation:",
        error
      );

      toast.error("Unable to cancel invitation.");
    } finally {
      setCancelling(false);
    }
  }

  // Deliberately NOT a top-level `if (loading) return <Spinner/>` - that
  // would unmount this whole subtree (including InviteToBranchModal)
  // every time onSuccess()/confirmCancel() call loadAll() again, which
  // would silently destroy the modal's "here's your invite link" success
  // screen the instant it appeared. Only the list area below reflects
  // `loading`, exactly like the existing app/admin/users page does.

  return (
    <div className="space-y-8">

      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            Invitations
          </h1>

          <p className="mt-2 text-mineral">
            Invite Admins, Dentists and Receptionists to any branch in
            your organization.
          </p>
        </div>

        <Button
          onClick={() => setShowInviteModal(true)}
          disabled={branches.length === 0}
        >
          <Plus size={16} /> Invite to a Branch
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading invitations..." />
      ) : invitations.length === 0 ? (
        <EmptyState
          title="No invitations yet"
          description="Invite your first team member to a branch."
          action={
            <Button
              onClick={() => setShowInviteModal(true)}
              disabled={branches.length === 0}
            >
              Invite to a Branch
            </Button>
          }
        />
      ) : (
        <Card title={`Invitations (${invitations.length})`}>
          <div className="space-y-4">
            {invitations.map((invitation) => {
              const status = invitationStatus(invitation);

              return (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-4 rounded-lg border border-sea-glass p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-graphite">
                        {invitation.full_name}
                      </h3>

                      <StatusPill status={status} />
                    </div>

                    <p className="text-sm text-mineral">
                      {invitation.email}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge color="blue">{invitation.clinic_name}</Badge>

                      <RoleBadge role={invitation.role} />

                      <span className="text-xs text-mineral">
                        {invitation.invited_by_name
                          ? `Invited by ${invitation.invited_by_name}`
                          : "Invited"}{" "}
                        &middot;{" "}
                        {status === "Pending"
                          ? `expires ${new Date(
                              invitation.expires_at
                            ).toLocaleDateString()}`
                          : status === "Expired"
                            ? `expired ${new Date(
                                invitation.expires_at
                              ).toLocaleDateString()}`
                            : `accepted ${new Date(
                                invitation.accepted_at as string
                              ).toLocaleDateString()}`}
                      </span>
                    </div>
                  </div>

                  {status === "Pending" && (
                    <Button
                      variant="danger"
                      onClick={() => setCancelTarget(invitation)}
                    >
                      <X size={15} /> Cancel
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <InviteToBranchModal
        open={showInviteModal}
        branches={branches}
        onClose={() => setShowInviteModal(false)}
        onSuccess={loadAll}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel invitation"
        description={
          cancelTarget
            ? `Cancel the invitation sent to ${cancelTarget.email} for ${cancelTarget.clinic_name}? The link will stop working.`
            : undefined
        }
        confirmText="Cancel Invitation"
        loading={cancelling}
        onCancel={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />

    </div>
  );
}

export default function OrganizationInvitationsPage() {
  return (
    <CeoGuard>
      <InvitationsPageContent />
    </CeoGuard>
  );
}
