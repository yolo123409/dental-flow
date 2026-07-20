import { getAppointmentAnalytics } from "./appointments";
import { getAppointmentChartData } from "./appointmentChart";
import { getRevenueChartData } from "./charts";
import { getPatientAnalytics } from "./patients";
import { getRevenueAnalytics } from "./revenue";
import { getTreatmentAnalytics } from "./treatments";

import { DashboardAnalytics } from "./types";

export async function getDashboardAnalytics(
  range: string = "All Time"
): Promise<DashboardAnalytics> {
  const [
    revenue,
    patients,
    appointments,
    treatments,
    revenueChart,
    appointmentChart,
  ] = await Promise.all([
    getRevenueAnalytics(range),
    getPatientAnalytics(range),
    getAppointmentAnalytics(range),
    getTreatmentAnalytics(range),
    getRevenueChartData(),
    getAppointmentChartData(range),
  ]);

  return {
    revenue,
    patients,
    appointments,
    treatments,
    revenueChart,
    appointmentChart,
    staff: [],
  };
}