import Card from "@/components/ui/Card";

export default function StaffPermissionsCard() {
  return (
    <Card title="Permissions">
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200">
        <p className="text-sm text-slate-500">
          Permissions will be loaded from the user's role.
        </p>
      </div>
    </Card>
  );
}