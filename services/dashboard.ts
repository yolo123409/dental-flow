import { supabase } from "@/lib/supabase";

export interface DashboardStats {
  patients: number;
  appointments: number;
  dentists: number;
  orders: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [
    patients,
    appointments,
    dentists,
    orders,
  ] = await Promise.all([
    supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      }),

    supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      }),

    supabase
      .from("dentists")
      .select("*", {
        count: "exact",
        head: true,
      }),

    supabase
      .from("orders")
      .select("*", {
        count: "exact",
        head: true,
      }),
  ]);

  return {
    patients: patients.count ?? 0,
    appointments: appointments.count ?? 0,
    dentists: dentists.count ?? 0,
    orders: orders.count ?? 0,
  };
}

export async function getRecentPatients(limit = 5) {
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .order("created_at", {
      ascending: false,
    })
    .limit(limit);

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function getTodaysAppointments() {
  const today = new Date()
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("appointments")
    .select(`
      *,
      patients (
        first_name,
        last_name
      ),
      dentists (
        full_name
      )
    `)
    .eq("appointment_date", today)
    .order("appointment_time");

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export async function getPendingOrders() {
  const { count, error } = await supabase
    .from("orders")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("payment_status", "Pending");

  if (error) {
    console.error(error);
    return 0;
  }

  return count ?? 0;
}

export async function getRevenue() {
  const { data, error } = await supabase
    .from("orders")
    .select("amount")
    .eq("payment_status", "Approved");

  if (error) {
    console.error(error);
    return 0;
  }

  return (
    data?.reduce(
      (sum, order) => sum + Number(order.amount ?? 0),
      0
    ) ?? 0
  );
}