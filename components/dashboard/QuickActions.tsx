"use client";

import { useRouter } from "next/navigation";

import {
  CalendarPlus,
  UserPlus,
  Stethoscope,
  Package,
} from "lucide-react";

import Card from "@/components/ui/Card";
import ActionButton from "@/components/ui/ActionButton";

export default function QuickActions() {
  const router = useRouter();

  return (
    <Card title="Quick Actions">

      <div className="grid gap-3">

        <ActionButton
          icon={<CalendarPlus size={18} />}
          onClick={() => router.push("/admin/appointments")}
        >
          New Appointment
        </ActionButton>

        <ActionButton
          icon={<UserPlus size={18} />}
          onClick={() => router.push("/admin/patients")}
        >
          New Patient
        </ActionButton>

        <ActionButton
          icon={<Stethoscope size={18} />}
          onClick={() => router.push("/admin/users")}
        >
          Add Dentist
        </ActionButton>

        <ActionButton
          icon={<Package size={18} />}
          onClick={() => router.push("/admin/treatments")}
        >
          Treatments
        </ActionButton>

      </div>

    </Card>
  );
}
