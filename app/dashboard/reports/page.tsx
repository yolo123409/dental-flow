import { getDashboardAnalytics } from "@/services/analytics";

import ReportsHeader from "@/components/reports/ReportsHeader";
import ReportStatCard from "@/components/reports/ReportStatCard";
import RevenueChart from "@/components/reports/RevenueChart";
import AppointmentStatusChart from "@/components/reports/AppointmentStatusChart";

interface ReportsPageProps {
  searchParams?: {
    range?: string;
  };
}

export default async function ReportsPage({
  searchParams,
}: ReportsPageProps) {
  const range =
    searchParams?.range ?? "All Time";

  const analytics =
    await getDashboardAnalytics(range);

  return (
    <div className="space-y-8">
      <ReportsHeader
        selectedRange={range}
        onRangeChange={() => {}}
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard
          title="Revenue"
          value={`KES ${analytics.revenue.totalRevenue.toLocaleString()}`}
          subtitle={`${analytics.revenue.paidInvoices} paid invoices`}
        />

        <ReportStatCard
          title="Patients"
          value={analytics.patients.totalPatients}
          subtitle={`${analytics.patients.newPatientsThisMonth} new patients`}
        />

        <ReportStatCard
          title="Appointments"
          value={analytics.appointments.totalAppointments}
          subtitle={`${analytics.appointments.completed} completed`}
        />

        <ReportStatCard
          title="Treatments"
          value={analytics.treatments.totalTreatments}
          subtitle={`${analytics.treatments.completedTreatments} completed`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <RevenueChart
          data={analytics.revenueChart}
        />

        <AppointmentStatusChart
          data={analytics.appointmentChart}
        />
      </div>
    </div>
  );
}