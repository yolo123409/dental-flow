"use client";

import {
  CalendarPlus,
  UserPlus,
  Stethoscope,
  Bot,
} from "lucide-react";

import Card from "@/components/ui/Card";
import ActionButton from "@/components/ui/ActionButton";

export default function QuickActions() {
  return (
    <Card title="Quick Actions">

      <div className="grid gap-3">

        <ActionButton
          icon={<CalendarPlus size={18} />}
        >
          New Appointment
        </ActionButton>

        <ActionButton
          icon={<UserPlus size={18} />}
        >
          New Patient
        </ActionButton>

        <ActionButton
          icon={<Stethoscope size={18} />}
        >
          Add Dentist
        </ActionButton>

        <ActionButton
          icon={<Bot size={18} />}
        >
          Open AI Receptionist
        </ActionButton>

      </div>

    </Card>
  );
}