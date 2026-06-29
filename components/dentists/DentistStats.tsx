"use client";

import {
  Users,
  UserCheck,
  UserX,
  Stethoscope,
} from "lucide-react";

interface Props {
  total: number;
  active: number;
  inactive: number;
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow">

      <div className="flex items-center justify-between">

        <div>

          <p className="text-sm text-slate-500">
            {title}
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            {value}
          </h2>

        </div>

        <div className="rounded-xl bg-blue-50 p-4 text-blue-600">
          {icon}
        </div>

      </div>

    </div>
  );
}

export default function DentistStats({
  total,
  active,
  inactive,
}: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

      <StatCard
        title="Total Dentists"
        value={total}
        icon={<Users size={24} />}
      />

      <StatCard
        title="Active"
        value={active}
        icon={<UserCheck size={24} />}
      />

      <StatCard
        title="Inactive"
        value={inactive}
        icon={<UserX size={24} />}
      />

      <StatCard
        title="Specialists"
        value={total}
        icon={<Stethoscope size={24} />}
      />

    </div>
  );
}