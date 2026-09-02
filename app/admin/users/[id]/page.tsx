"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import PageContainer from "@/components/ui/PageContainer";
import PermissionGuard from "@/components/auth/PermissionGuard";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { logError } from "@/lib/logError";
import { useAuth } from "@/contexts/AuthContext";
import usePermissions from "@/hooks/usePermissions";

import {
  StaffHeader,
  StaffInfoCard,
  StaffActivityCard,
  StaffPermissionsCard,
  OwnProfileCard,
} from "@/components/users";

import { ClinicUser } from "@/types";

import {
  getUser,
  suspendUser,
  activateUser,
  deleteUser,
} from "@/services/users";

import { toast } from "sonner";

function StaffProfilePageContent() {
  const params = useParams();
  const router = useRouter();

  const { profile, refreshProfile } = useAuth();
  const { hasPermission } = usePermissions();

  const id = params.id as string;

  const isSelf = profile?.id === id;
  const canManageUsers = hasPermission("users");

  // Full-app audit fix H17: someone viewing their OWN profile without
  // the "users" permission (every Dentist/Receptionist, via the account
  // menu's "My Profile" link) gets a reduced, self-service view instead
  // of the full staff-management page.
  const reducedSelfView = isSelf && !canManageUsers;

  const [user, setUser] = useState<ClinicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      setLoading(true);

      if (reducedSelfView) {
        // getUser() requires the "users" permission this branch is
        // specifically for people without - profile from useAuth() is
        // already loaded with no such gate (it's how the app knows
        // who's logged in at all).
        setUser(profile);
      } else {
        const data = await getUser(id);

        setUser(data);
      }
    } catch (error: unknown) {
      logError("[Staff profile] loadUser failed:", error);

      toast.error("Unable to load staff member.");
    } finally {
      setLoading(false);
    }
  }, [id, reducedSelfView, profile]);

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
        isSelf={isSelf}
        onToggleStatus={toggleStatus}
        onDelete={removeUser}
      />

      {reducedSelfView ? (

        <div className="mt-6">

          <OwnProfileCard user={user} onSaved={refreshProfile} />

        </div>

      ) : (

        <div className="mt-6 grid gap-6 lg:grid-cols-3">

          <div className="space-y-6 lg:col-span-2">

            <StaffInfoCard user={user} />

            <StaffActivityCard />

          </div>

          <div>

            <StaffPermissionsCard />

          </div>

        </div>

      )}

    </PageContainer>
  );
}

export default function StaffProfilePage() {
  const params = useParams();
  const { profile } = useAuth();

  const isSelf = profile?.id === (params.id as string);

  return (
    <PermissionGuard permission="users" bypass={isSelf}>
      <StaffProfilePageContent />
    </PermissionGuard>
  );
}