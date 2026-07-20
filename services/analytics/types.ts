import { RevenueChartPoint } from "./charts";
import { AppointmentChartPoint } from "./appointmentChart";

export interface RevenueAnalytics {
  totalRevenue: number;
  outstandingBalance: number;
  totalInvoices: number;
  paidInvoices: number;
  unpaidInvoices: number;
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