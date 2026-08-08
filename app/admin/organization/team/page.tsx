"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import PageContainer from "@/components/ui/PageContainer";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import AccessDenied from "@/components/auth/AccessDenied";

import OrganizationTeamTable from "@/components/organization/OrganizationTeamTable";
import InviteOrganizationMemberModal from "@/components/organization/InviteOrganizationMemberModal";
import EditOrganizationMemberModal from "@/components/organization/EditOrganizationMemberModal";

import { useAuth } from "@/contexts/AuthContext";

import {
  getOrganizationMembers,
  removeOrganizationMember,
} from "@/services/organizations";
import {
  getPendingOrganizationInvitations,
  resendOrganizationInvitation,
  cancelOrganizationInvitation,
} from "@/services/organizationInvitations";

import { OrganizationUser } from "@/types/organization";
import { OrganizationInvitation } from "@/types/organizationInvitation";

export default function OrganizationTeamPage() {
  const { organizationUser, loading: authLoading } = useAuth();

  const [members, setMembers] = useState<OrganizationUser[]>([]);
  const [invitations, setInvitations] = useState<
    OrganizationInvitation[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] =
    useState<OrganizationUser | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      setLoading(true);

      const [memberRows, invitationRows] = await Promise.all([
        getOrganizationMembers(),
        getPendingOrganizationInvitations(),
      ]);

      setMembers(memberRows);
      setInvitations(invitationRows);
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
  }, []);

  useEffect(() => {
    if (organizationUser?.role === "CEO") {
      loadTeam();
    } else {
      setLoading(false);
    }
  }, [organizationUser, loadTeam]);

  async function handleRemoveMember(organizationUserId: string) {
    if (!confirm("Remove this member's organization access?")) return;

    try {
      await removeOrganizationMember(organizationUserId);

      toast.success("Access removed.");

      await loadTeam();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to remove access."
      );
    }
  }

  async function handleResendInvitation(invitationId: string) {
    try {
      await resendOrganizationInvitation(invitationId);

      toast.success("Invitation link refreshed.");

      await loadTeam();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to resend invitation."
      );
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!confirm("Cancel this invitation?")) return;

    try {
      await cancelOrganizationInvitation(invitationId);

      toast.success("Invitation cancelled.");

      await loadTeam();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to cancel invitation."
      );
    }
  }

  if (authLoading || loading) {
    return (
      <PageContainer>
        <LoadingSpinner text="Loading team..." />
      </PageContainer>
    );
  }

  if (organizationUser?.role !== "CEO") {
    return (
      <PageContainer>
        <AccessDenied />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Team &amp; Access
          </h1>

          <p className="mt-2 text-mineral">
            Invite partners and managers to help run your organization.
            Each person gets their own DentalFlow account.
          </p>
        </div>

        <Button onClick={() => setInviteOpen(true)}>
          Invite Member
        </Button>
      </div>

      <OrganizationTeamTable
        members={members}
        invitations={invitations}
        onEditMember={setEditingMember}
        onRemoveMember={handleRemoveMember}
        onResendInvitation={handleResendInvitation}
        onCancelInvitation={handleCancelInvitation}
      />

      <InviteOrganizationMemberModal
        open={inviteOpen}
        organizationId={organizationUser.organization_id}
        onClose={() => setInviteOpen(false)}
        onSuccess={loadTeam}
      />

      <EditOrganizationMemberModal
        open={editingMember !== null}
        organizationId={organizationUser.organization_id}
        member={editingMember}
        onClose={() => setEditingMember(null)}
        onSuccess={loadTeam}
      />
    </PageContainer>
  );
}
