"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { getUsers } from "@/services/users";
import {
  getPendingInvitations,
  resendInvitation,
  cancelInvitation,
} from "@/services/staffInvitations";

import { ClinicUser } from "@/types/clinicUser";
import { StaffInvitation } from "@/types/staffInvitation";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import StatusBadge from "@/components/ui/StatusBadge";
import RoleBadge from "@/components/ui/RoleBadge";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  StaffModal,
  InviteStaffModal,
  PendingInvitationRow,
} from "@/components/users";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { logError } from "@/lib/logError";

import {
  suspendUser,
  activateUser,
  deleteUser,
} from "@/services/users";

export default function UsersPage() {
  const [users, setUsers] = useState<ClinicUser[]>([]);
  const [invitations, setInvitations] = useState<
    StaffInvitation[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [selectedUser, setSelectedUser] =
    useState<ClinicUser | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<ClinicUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [cancelTarget, setCancelTarget] =
    useState<StaffInvitation | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [resendingId, setResendingId] = useState<
    string | null
  >(null);

  const realtimeTables = useMemo(
    () => ["clinic_users", "staff_invitations"],
    []
  );

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      const [staff, pending] = await Promise.all([
        getUsers(),
        getPendingInvitations(),
      ]);

      setUsers(staff);
      setInvitations(pending);
    } catch (error) {
      logError("[Staff page] Failed to load staff:", error);

      toast.error("Unable to load staff.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadAll,
  });

  async function handleSuspend(user: ClinicUser) {
    try {
      if (user.status === "Suspended") {
        await activateUser(user.id);

        toast.success("Staff member activated.");
      } else {
        await suspendUser(user.id);

        toast.success("Staff member suspended.");
      }

      await loadAll();
    } catch (error) {
      logError("[Staff page] Failed to update staff status:", error);

      toast.error("Unable to update staff status.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);

      await deleteUser(deleteTarget.id);

      toast.success("Staff member removed.");

      setDeleteTarget(null);

      await loadAll();
    } catch (error) {
      logError("[Staff page] Failed to remove staff member:", error);

      toast.error("Unable to remove staff member.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleResend(invitation: StaffInvitation) {
    try {
      setResendingId(invitation.id);

      const { link } = await resendInvitation(invitation.id);

      await navigator.clipboard.writeText(link);

      toast.success(
        "New invitation link copied to clipboard."
      );

      await loadAll();
    } catch (error) {
      logError("[Staff page] Failed to resend invitation:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to resend invitation."
      );
    } finally {
      setResendingId(null);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;

    try {
      setCancelling(true);

      await cancelInvitation(cancelTarget.id);

      toast.success("Invitation cancelled.");

      setCancelTarget(null);

      await loadAll();
    } catch (error) {
      logError("[Staff page] Failed to cancel invitation:", error);

      toast.error("Unable to cancel invitation.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <PermissionGuard permission="users">
      <div className="space-y-8">
        {/* Header */}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">
              Clinic Staff
            </h1>

            <p className="mt-2 text-slate-500">
              Manage owners, administrators, dentists and
              receptionists.
            </p>
          </div>

          <Button onClick={() => setShowInviteModal(true)}>
            + Invite Staff
          </Button>
        </div>

        {/* Staff List */}

        <Card title={`Staff Members (${users.length})`}>
          {loading ? (
            <div className="flex justify-center py-16">
              <p className="text-slate-500">
                Loading staff...
              </p>
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <h3 className="text-xl font-semibold">
                No staff members yet
              </h3>

              <p className="mt-2 text-slate-500">
                Invite your first administrator, dentist or
                receptionist.
              </p>

              <Button
                className="mt-6"
                onClick={() => setShowInviteModal(true)}
              >
                + Invite Staff
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {users.map((user) => {
                const isOwner = user.role === "Owner";

                return (
                  <div
                    key={user.id}
                    className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="flex-1"
                      >
                        <h2 className="text-lg font-bold hover:text-blue-600 transition-colors">
                          {user.full_name}
                        </h2>

                        <p className="mt-1 text-slate-500">
                          {user.email}
                        </p>

                        {user.phone && (
                          <p className="text-sm text-slate-500">
                            {user.phone}
                          </p>
                        )}

                        <div className="mt-4 flex gap-3">
                          <RoleBadge role={user.role} />

                          <StatusBadge status={user.status} />
                        </div>
                      </Link>

                      {isOwner ? (
                        <p className="text-sm italic text-slate-400">
                          Clinic owner
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSelectedUser(user);
                              setShowEditModal(true);
                            }}
                          >
                            Edit
                          </Button>

                          <Button
                            variant="secondary"
                            onClick={() =>
                              handleSuspend(user)
                            }
                          >
                            {user.status === "Suspended"
                              ? "Activate"
                              : "Suspend"}
                          </Button>

                          <Button
                            variant="danger"
                            onClick={() =>
                              setDeleteTarget(user)
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Pending Invitations */}

        {invitations.length > 0 && (
          <Card
            title={`Pending Invitations (${invitations.length})`}
          >
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <PendingInvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onResend={handleResend}
                  onCancel={setCancelTarget}
                  resending={
                    resendingId === invitation.id
                  }
                />
              ))}
            </div>
          </Card>
        )}

        {/* Invite Staff Modal */}

        <InviteStaffModal
          open={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onSuccess={loadAll}
        />

        {/* Edit Staff Modal */}

        <StaffModal
          open={showEditModal}
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onSuccess={loadAll}
        />

        {/* Remove Staff Confirm */}

        <ConfirmDialog
          open={deleteTarget !== null}
          title="Remove staff member"
          description={
            deleteTarget
              ? `Remove ${deleteTarget.full_name} from this clinic? They will lose access immediately.`
              : undefined
          }
          confirmText="Remove"
          loading={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />

        {/* Cancel Invitation Confirm */}

        <ConfirmDialog
          open={cancelTarget !== null}
          title="Cancel invitation"
          description={
            cancelTarget
              ? `Cancel the invitation sent to ${cancelTarget.email}? The link will stop working.`
              : undefined
          }
          confirmText="Cancel Invitation"
          loading={cancelling}
          onCancel={() => setCancelTarget(null)}
          onConfirm={confirmCancel}
        />
      </div>
    </PermissionGuard>
  );
}
