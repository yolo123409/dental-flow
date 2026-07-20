import { getCurrentClinicId } from "@/services/clinic";

export interface RevenueChartPoint {
  month: string;
  revenue: number;
}

export async function getRevenueChartData(): Promise<
  RevenueChartPoint[]
> {
  // Keep clinic resolution so the function signature
  // remains compatible when Billing is implemented.
  await getCurrentClinicId();

  return [];
}