"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Plus, ArrowRight } from "lucide-react";

import CeoGuard from "@/components/auth/CeoGuard";
import useOrganization from "@/hooks/useOrganization";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";

import CreateBranchModal from "@/components/organization/CreateBranchModal";

import {
  getOrganizationBranches,
  switchActiveBranch,
} from "@/services/organizations";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { OrganizationBranch } from "@/types/organization";

function BranchesPageContent() {
  const router = useRouter();

  const {
    organizationUser,
    reload: reloadOrganization,
  } = useOrganization();

  const [branches, setBranches] = useState<OrganizationBranch[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const data = await getOrganizationBranches(
        organizationUser.organization_id
      );

      setBranches(data);
    } catch (error) {
      logError("[Branches page] Failed to load branches:", error);

      toast.error("Unable to load branches.");
    } finally {
      setLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  async function handleAccess(branch: OrganizationBranch) {
    try {
      setSwitchingId(branch.id);

      await switchActiveBranch(branch.id);
      await reloadOrganization();

      router.push("/admin");
      router.refresh();
    } catch (error) {
      logError("[Branches page] Failed to switch branch:", error);

      toast.error(
        getSafeErrorMessage(error, "Unable to open this branch.")
      );

      setSwitchingId(null);
    }
  }

  async function handleCreated() {
    await loadBranches();
  }

  // Deliberately NOT a top-level `if (loading) return <Spinner/>` - that
  // would unmount this whole subtree (including CreateBranchModal) every
  // time onSuccess() calls loadBranches() again. Only the list area
  // below reflects `loading`, exactly like the existing app/admin/users
  // page does.

  return (
    <div className="space-y-8">

      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            Branches
          </h1>

          <p className="mt-2 text-mineral">
            Every branch is a fully independent Dental Flow clinic under
            your organization.
          </p>
        </div>

        <Button onClick={() => setShowCreateModal(true)}>
          <Plus size={16} /> Create Branch
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading branches..." />
      ) : branches.length === 0 ? (
        <EmptyState
          title="No branches yet"
          description="Create your first additional branch to get started."
          action={
            <Button onClick={() => setShowCreateModal(true)}>
              Create Branch
            </Button>
          }
        />
      ) : (
        <Card title={`Branches (${branches.length})`}>
          <div className="space-y-4">
            {branches.map((branch) => {
              const isActive =
                branch.id === organizationUser?.active_clinic_id;

              return (
                <div
                  key={branch.id}
                  className="flex flex-col gap-4 rounded-lg border border-sea-glass p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-sea-glass p-3 text-eucalyptus">
                      <Building2 size={20} />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-graphite">
                          {branch.name}
                        </h3>

                        {isActive && (
                          <Badge color="green">Current</Badge>
                        )}
                      </div>

                      <p className="text-sm text-mineral">
                        Created{" "}
                        {new Date(
                          branch.created_at
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {!isActive && (
                    <Button
                      variant="secondary"
                      onClick={() => handleAccess(branch)}
                      disabled={switchingId === branch.id}
                    >
                      {switchingId === branch.id
                        ? "Opening..."
                        : "Access Branch"}{" "}
                      <ArrowRight size={16} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <CreateBranchModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreated}
      />

    </div>
  );
}

export default function OrganizationBranchesPage() {
  return (
    <CeoGuard>
      <BranchesPageContent />
    </CeoGuard>
  );
}
