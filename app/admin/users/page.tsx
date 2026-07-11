"use client";

import { useEffect, useState } from "react";


import { getUsers } from "@/services/users";

import { ClinicUser } from "@/types/clinicUser";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { StaffModal } from "@/components/users";

import StatusBadge from "@/components/ui/StatusBadge";
import RoleBadge from "@/components/ui/RoleBadge";

import Link from "next/link";

import {
  suspendUser,
  activateUser,
  deleteUser,
} from "@/services/users";

import { toast } from "sonner";

import PermissionGuard from "@/components/auth/PermissionGuard";

export default function UsersPage() {
  const [users, setUsers] = useState<ClinicUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);

  const [selectedUser, setSelectedUser] =
    useState<ClinicUser | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);

      const data = await getUsers();

      setUsers(data);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setLoading(false);
    }
  }


  async function handleSuspend(user: ClinicUser) {
  try {
    if (user.status === "Suspended") {
      await activateUser(user.id);

      toast.success("Staff member activated.");
    } else {
      await suspendUser(user.id);

      toast.success("Staff member suspended.");
    }

    await loadUsers();
  } catch (error) {
    console.error(error);

    toast.error("Unable to update staff status.");
  }
}

async function handleDelete(user: ClinicUser) {
  const confirmed = window.confirm(
    `Delete ${user.full_name}?`
  );

  if (!confirmed) return;

  try {
    await deleteUser(user.id);

    toast.success("Staff member deleted.");

    await loadUsers();
  } catch (error) {
    console.error(error);

    toast.error("Unable to delete staff.");
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
            Manage administrators, dentists and receptionists.
          </p>

        </div>

        <Button
          onClick={() => {
            setSelectedUser(null);
            setShowModal(true);
          }}
        >
          + Add Staff Member
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
              Create your first administrator,
              dentist or receptionist.
            </p>

            <Button
              className="mt-6"
              onClick={() => {
                setSelectedUser(null);
                setShowModal(true);
              }}
            >
              + Add Staff Member
            </Button>

          </div>

        ) : (

          <div className="space-y-4">

            {users.map((user) => (

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

                  <div className="flex gap-2">

                    <div className="flex gap-2">

  <Button
    variant="secondary"
    onClick={() => {
      setSelectedUser(user);
      setShowModal(true);
    }}
  >
    Edit
  </Button>

  <Button
    variant="secondary"
    onClick={() => handleSuspend(user)}
  >
    {user.status === "Suspended"
      ? "Activate"
      : "Suspend"}
  </Button>

  <Button
    variant="danger"
    onClick={() => handleDelete(user)}
  >
    Delete
  </Button>

</div>

                  </div>

                </div>

              </div>

            ))}

          </div>

        )}

      </Card>

      {/* Staff Modal */}

      <StaffModal
        open={showModal}
        mode={
          selectedUser
            ? "edit"
            : "create"
        }
        user={selectedUser}
        onClose={() => {
          setShowModal(false);
          setSelectedUser(null);
        }}
        onSuccess={loadUsers}
      />

    </div>
  </PermissionGuard>

);
}