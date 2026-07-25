import { RevenueChartPoint } from "./charts";
import { AppointmentChartPoint } from "./appointmentChart";

export interface RevenueAnalytics {
  totalRevenue: number;
  outstandingBalance: number;
  totalInvoices: number;
  paidInvoices: number;
  unpaidInvoices: number;

  // "Revenue" (`totalRevenue`) is already tax-inclusive - the sum of
  // `total` on paid invoices. These two are derived from the same query
  // rather than a separate one: totalTaxCollected sums each invoice's own
  // `tax`, and revenueExcludingTax is just totalRevenue minus that.
  totalTaxCollected: number;
  revenueExcludingTax: number;
}

export interface PatientAnalytics {
  totalPatients: number;
  newPatientsThisMonth: number;
  returningPatients: number;
  inactivePatients: number;
}

export interface AppointmentAnalytics {
  totalAppointments: number;
  scheduledToday: number;
  completed: number;
  cancelled: number;
  noShows: number;
}

export interface TreatmentSummary {
  treatment: string;
  count: number;
  revenue: number;
}

export interface TreatmentAnalytics {
  totalTreatments: number;
  totalRevenue: number;
  averageTreatmentValue: number;
  completedTreatments: number;
  pendingTreatments: number;
  treatments: TreatmentSummary[];
}

export interface DashboardAnalytics {
  revenue: RevenueAnalytics;
  patients: PatientAnalytics;
  appointments: AppointmentAnalytics;
  treatments: TreatmentAnalytics;

  revenueChart: RevenueChartPoint[];
  appointmentChart: AppointmentChartPoint[];

  staff: unknown[];
}