"use client";

import { useEffect, useState } from "react";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";

import { ClinicUser } from "@/types/clinicUser";

import {
  createUser,
  updateUser,
} from "@/services/users";

import { toast } from "sonner";


interface StaffModalProps {
  open: boolean;
  mode: "create" | "edit";
  user?: ClinicUser | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function StaffModal({
  open,
  mode,
  user,
  onClose,
  onSuccess,
}: StaffModalProps) {
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [role, setRole] =
    useState("Receptionist");

  const [status, setStatus] =
    useState("Active");

  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && user) {
      setFullName(user.full_name);
      setEmail(user.email);
      setPhone(user.phone ?? "");
      setRole(user.role);
      setStatus(user.status);
    } else {
      setFullName("");
      setEmail("");
      setPhone("");
      setRole("Receptionist");
      setStatus("Active");
    }
  }, [open, mode, user]);

  async function save() {
    try {
      setLoading(true);

      if (mode === "create") {
        await createUser({
          full_name: fullName,
          email,
          phone,
          role,
        });

        toast.success("Staff member created.");
      } else {
        await updateUser(user!.id, {
          full_name: fullName,
          email,
          phone,
          role,
          status,
        });

        toast.success("Staff member updated.");
      }

      await onSuccess();

      onClose();

    } catch (error) {
      console.error(error);

      toast.error("Unable to save staff member.");

    } finally {
      setLoading(false);
    }
  }

  return (
    <FormModal
      open={open}
      title={
        mode === "create"
          ? "Add Staff Member"
          : "Edit Staff Member"
      }
      loading={loading}
      onClose={onClose}
      onSubmit={save}
      submitText={
        mode === "create"
          ? "Create"
          : "Save Changes"
      }
    >

      <FormInput
        label="Full Name"
        value={fullName}
        onChange={setFullName}
      />

      <FormInput
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
      />

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
            setRole(e.target.value)
          }
          className="w-full rounded-xl border border-slate-300 p-3"
        >
          <option>Admin</option>
          <option>Dentist</option>
          <option>Receptionist</option>
        </select>

      </div>

      {mode === "edit" && (

        <div>

          <label className="mb-2 block font-medium">
            Status
          </label>

          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
            className="w-full rounded-xl border border-slate-300 p-3"
          >
            <option>Active</option>
            <option>Pending</option>
            <option>Suspended</option>
          </select>

        </div>

      )}

    </FormModal>
  );
}