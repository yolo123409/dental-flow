import Card from "@/components/ui/Card";
import { ClinicUser } from "@/types/clinicUser";

interface StaffInfoCardProps {
  user: ClinicUser;
}

interface InfoItemProps {
  label: string;
  value: string;
}

function InfoItem({
  label,
  value,
}: InfoItemProps) {
  return (
    <div className="space-y-1 rounded-2xl border border-slate-100 p-4 transition hover:border-blue-200 hover:bg-slate-50">
      <p className="text-sm font-medium text-slate-500">
        {label}
      </p>

      <p className="text-base font-semibold text-slate-900 break-words">
        {value}
      </p>
    </div>
  );
}

export default function StaffInfoCard({
  user,
}: StaffInfoCardProps) {
  return (
    <Card title="Staff Information">
      <div className="grid gap-4 md:grid-cols-2">

        <InfoItem
          label="Email"
          value={user.email}
        />

        <InfoItem
          label="Phone"
          value={user.phone || "-"}
        />

        <InfoItem
          label="Role"
          value={user.role}
        />

        <InfoItem
          label="Status"
          value={user.status}
        />

        <InfoItem
          label="Last Login"
          value={user.last_login ?? "Never"}
        />

        <InfoItem
          label="Joined"
          value={user.created_at ?? "-"}
        />

      </div>
    </Card>
  );
}