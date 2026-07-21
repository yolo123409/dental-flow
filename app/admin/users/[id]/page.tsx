"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import PageContainer from "@/components/ui/PageContainer";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { logError } from "@/lib/logError";

import {
  StaffHeader,
  StaffInfoCard,
  StaffActivityCard,
  StaffPermissionsCard,
} from "@/components/users";

import { ClinicUser } from "@/types";

import {
  getUser,
  suspendUser,
  activateUser,
  deleteUser,
} from "@/services/users";

import { toast } from "sonner";

export default function StaffProfilePage() {
  const params = useParams();
  const router = useRouter();

  const id = params.id as string;

  const [user, setUser] = useState<ClinicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      setLoading(true);

      const data = await getUser(id);

      setUser(data);
    } catch (error: unknown) {
      logError("[Staff profile] loadUser failed:", error);

      toast.error("Unable to load staff member.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const realtimeTables = useMemo(
    () => ["clinic_users"],
    []
  );

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadUser,
  });

  async function toggleStatus() {
    if (!user) return;

    try {
      if (user.status === "Suspended") {
        await activateUser(user.id);
        toast.success("Staff member activated.");
      } else {
        await suspendUser(user.id);
        toast.success("Staff member suspended.");
      }

      await loadUser();
    } catch (error) {
      logError("[Staff profile] Failed to update status:", error);
      toast.error("Unable to update status.");
    }
  }

  async function removeUser() {
    if (!user) return;

    const confirmed = window.confirm(
      `Delete ${user.full_name}?`
    );

    if (!confirmed) return;

    try {
      await deleteUser(user.id);

      toast.success("Staff member deleted.");

      router.push("/admin/users");
    } catch (error) {
      logError("[Staff profile] Failed to delete user:", error);
      toast.error("Unable to delete user.");
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] items-center justify-center">
          Loading staff member...
        </div>
      </PageContainer>
    );
  }

  if (!user) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] items-center justify-center">
          Staff member not found.
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>

      <StaffHeader
        user={user}
        onToggleStatus={toggleStatus}
        onDelete={removeUser}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">

        <div className="space-y-6 lg:col-span-2">

          <StaffInfoCard user={user} />

          <StaffActivityCard />

        </div>

        <div>

          <StaffPermissionsCard />

        </div>

      </div>

    </PageContainer>
  );
}