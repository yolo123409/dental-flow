import Card from "@/components/ui/Card";

export default function StaffActivityCard() {
  return (
    <Card title="Recent Activity">
      <div className="space-y-5">
        <div className="border-l-4 border-blue-500 pl-4">
          <h3 className="font-semibold">
            Added Patient
          </h3>

          <p className="text-sm text-slate-500">
            Today • 10:42 AM
          </p>
        </div>
      </div>
    </Card>
  );
}