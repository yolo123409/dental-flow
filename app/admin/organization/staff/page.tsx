"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Crown } from "lucide-react";

import CeoGuard from "@/components/auth/CeoGuard";
import useOrganization from "@/hooks/useOrganization";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import RoleBadge from "@/components/ui/RoleBadge";
import StatusBadge from "@/components/ui/StatusBadge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

import { getOrganizationStaff } from "@/services/organizations";
import { logError } from "@/lib/logError";

import { OrganizationStaffMember } from "@/types/organization";

function StaffPageContent() {
  const { organizationUser } = useOrganization();

  const [staff, setStaff] = useState<OrganizationStaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStaff = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const data = await getOrganizationStaff(
        organizationUser.organization_id
      );

      setStaff(data);
    } catch (error) {
      logError("[Organization staff page] Failed to load staff:", error);

      toast.error("Unable to load organization staff.");
    } finally {
      setLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  if (loading) {
    return (
      <LoadingSpinner text="Loading organization staff..." />
    );
  }

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          Organization Staff
        </h1>

        <p className="mt-2 text-mineral">
          Everyone with access to a branch in your organization. A
          person&apos;s clinic role can differ from branch to branch.
        </p>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          title="No staff yet"
          description="Staff appear here once they're added to a branch."
        />
      ) : (
        <Card title={`Staff (${staff.length})`}>
          <div className="space-y-4">
            {staff.map((member) => (
              <div
                key={member.auth_user_id}
                className="rounded-lg border border-sea-glass p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-graphite">
                        {member.full_name}
                      </h3>

                      {member.organization_role === "CEO" && (
                        <Badge color="purple">
                          <span className="flex items-center gap-1">
                            <Crown size={11} /> CEO
                          </span>
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm text-mineral">
                      {member.email}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {member.branches.map((branch) => (
                    <div
                      key={branch.clinic_id}
                      className="flex items-center gap-2 rounded-lg bg-porcelain px-3 py-2"
                    >
                      <span className="text-sm font-medium text-graphite">
                        {branch.clinic_name}
                      </span>

                      <RoleBadge role={branch.role} />

                      <StatusBadge status={branch.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}

export default function OrganizationStaffPage() {
  return (
    <CeoGuard>
      <StaffPageContent />
    </CeoGuard>
  );
}
