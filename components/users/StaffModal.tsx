"use client";

import { useEffect, useState } from "react";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";

import { ClinicUser } from "@/types/clinicUser";
import { INVITABLE_ROLES, InvitableRole } from "@/lib/permissions";

import { updateUser } from "@/services/users";
import { getSafeErrorMessage } from "@/lib/logError";

import { toast } from "sonner";

interface StaffModalProps {
  open: boolean;
  user: ClinicUser | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function StaffModal({
  open,
  user,
  onClose,
  onSuccess,
}: StaffModalProps) {
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [role, setRole] = useState<InvitableRole>(
    "Receptionist"
  );

  useEffect(() => {
    if (!open || !user) return;

    setFullName(user.full_name);
    setPhone(user.phone ?? "");
    setRole(user.role as InvitableRole);
  }, [open, user]);

  async function save() {
    if (!user) return;

    try {
      setLoading(true);

      await updateUser(user.id, {
        full_name: fullName,
        phone,
        role,
      });

      toast.success("Staff member updated.");

      await onSuccess();

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to save staff member.")
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormModal
      open={open}
      title="Edit Staff Member"
      loading={loading}
      onClose={onClose}
      onSubmit={save}
      submitText="Save Changes"
    >
      <FormInput
        label="Full Name"
        value={fullName}
        onChange={setFullName}
      />

      <div>
        <label className="mb-2 block font-medium">
          Email
        </label>

        <input
          value={user?.email ?? ""}
          disabled
          className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 p-3 text-slate-500"
        />

        <p className="mt-1 text-xs text-slate-400">
          Set when the invitation was accepted - can&apos;t be
          changed here.
        </p>
      </div>

      <FormInput
        label="Phone"
        value={phone}
        onChange={setPhone}
      />

      <div>
        <label className="mb-2 block font-medium">
          Role
        </label>

        <select
          value={role}
          onChange={(e) =>
            setRole(e.target.value as InvitableRole)
          }
          className="w-full rounded-xl border border-slate-300 p-3"
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
    </FormModal>
  );
}
