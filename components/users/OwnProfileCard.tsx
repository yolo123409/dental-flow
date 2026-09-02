"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { ClinicUser } from "@/types/clinicUser";
import { updateOwnProfile } from "@/services/users";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  user: ClinicUser;
  onSaved: () => Promise<void>;
}

export default function OwnProfileCard({ user, onSaved }: Props) {
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(user.full_name);
    setPhone(user.phone ?? "");
  }, [user]);

  async function save() {
    if (!fullName.trim()) {
      toast.error("Full name cannot be empty.");
      return;
    }

    try {
      setSaving(true);

      await updateOwnProfile(fullName, phone);

      toast.success("Profile updated.");

      await onSaved();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to update profile.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="My Profile">
      <div className="space-y-5">
        <FormInput
          label="Full Name"
          value={fullName}
          onChange={setFullName}
        />

        <div>
          <label className="mb-2 block text-sm font-semibold text-graphite">
            Email
          </label>

          <input
            value={user.email}
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 p-3 text-slate-500"
          />

          <p className="mt-1 text-xs text-slate-400">
            Contact an Owner/Admin to change your email.
          </p>
        </div>

        <FormInput label="Phone" value={phone} onChange={setPhone} />

        <div>
          <label className="mb-2 block text-sm font-semibold text-graphite">
            Role
          </label>

          <input
            value={user.role}
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 p-3 text-slate-500"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
