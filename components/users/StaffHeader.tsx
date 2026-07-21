"use client";

import Link from "next/link";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import StatusBadge from "@/components/ui/StatusBadge";
import RoleBadge from "@/components/ui/RoleBadge";

import { ClinicUser } from "@/types/clinicUser";

interface StaffHeaderProps {
  user: ClinicUser;
  onToggleStatus: () => void;
  onDelete: () => void;
}

export default function StaffHeader({
  user,
  onToggleStatus,
  onDelete,
}: StaffHeaderProps) {
  const isOwner = user.role === "Owner";

  return (
    <Card>
      <div className="space-y-6">
        <Link
          href="/admin/users"
          className="inline-flex text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          ← Back to Staff
        </Link>

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <Avatar
              name={user.full_name}
              avatarUrl={user.avatar_url}
              size="lg"
            />

            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {user.full_name}
              </h1>

              <p className="mt-1 text-slate-500">
                {user.email}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusBadge status={user.status} />

                <RoleBadge role={user.role} />
              </div>

              <p className="mt-4 text-sm text-slate-400">
                Joined {user.created_at ?? "-"}
              </p>
            </div>
          </div>

          {isOwner ? (
            <p className="text-sm italic text-slate-400">
              Clinic owner - can&apos;t be suspended or
              removed here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={onToggleStatus}
              >
                {user.status === "Suspended"
                  ? "Activate"
                  : "Suspend"}
              </Button>

              <Button
                variant="danger"
                onClick={onDelete}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}