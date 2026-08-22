import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { getCurrentClinicId } from "./clinic";
import { getCurrentClinicUser } from "./clinicUsers";

import {
  CreateNotificationInput,
  Notification,
  NotificationEntityType,
} from "@/types/notification";

const RECENT_LIMIT = 20;

/* -------------------------------------- */
/* Retrieval (single source of truth)     */
/* -------------------------------------- */

export async function getNotifications(
  limit = RECENT_LIMIT
): Promise<Notification[]> {
  const clinicId = await getCurrentClinicId();
  const clinicUser = await getCurrentClinicUser();

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("clinic_id", clinicId)
    .or(`user_id.is.null,user_id.eq.${clinicUser?.id}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logError("[notifications] Failed to load notifications:", error);

    throw toError(error);
  }

  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(): Promise<number> {
  const clinicId = await getCurrentClinicId();
  const clinicUser = await getCurrentClinicUser();

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("read", false)
    .or(`user_id.is.null,user_id.eq.${clinicUser?.id}`);

  if (error) {
    logError(
      "[notifications] Failed to load unread count:",
      error
    );

    throw toError(error);
  }

  return count ?? 0;
}

/* -------------------------------------- */
/* Interactions                           */
/* -------------------------------------- */

export async function markNotificationRead(
  id: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError(
      "[notifications] Failed to mark notification read:",
      error
    );

    throw toError(error);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const clinicId = await getCurrentClinicId();
  const clinicUser = await getCurrentClinicUser();

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("clinic_id", clinicId)
    .eq("read", false)
    .or(`user_id.is.null,user_id.eq.${clinicUser?.id}`);

  if (error) {
    logError(
      "[notifications] Failed to mark all notifications read:",
      error
    );

    throw toError(error);
  }
}

export async function deleteNotification(
  id: string
): Promise<void> {
  const clinicId = await getCurrentClinicId();

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("id", id);

  if (error) {
    logError(
      "[notifications] Failed to delete notification:",
      error
    );

    throw toError(error);
  }
}

/**
 * Where clicking a notification should navigate to. Kept here, next to
 * notification creation, so the "what does this notification link to"
 * decision lives in exactly one place.
 */
export function getNotificationHref(
  notification: Pick<Notification, "entity_type" | "entity_id">
): string | null {
  if (!notification.entity_type || !notification.entity_id) {
    return null;
  }

  const routes: Record<NotificationEntityType, string> = {
    patient: `/admin/patients/${notification.entity_id}`,
    appointment: `/admin/appointments/${notification.entity_id}`,
    invoice: `/admin/billing/${notification.entity_id}`,
    staff: `/admin/users/${notification.entity_id}`,
  };

  return routes[notification.entity_type] ?? null;
}

/* -------------------------------------- */
/* Creation (best-effort, never throws -   */
/* a failed notification must never fail   */
/* the business action that triggered it)  */
/* -------------------------------------- */

async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();

    const { error } = await supabase
      .from("notifications")
      .insert({
        clinic_id: clinicId,
        user_id: input.user_id ?? null,
        title: input.title,
        message: input.message,
        type: input.type,
        entity_type: input.entity_type ?? null,
        entity_id: input.entity_id ?? null,
      });

    if (error) {
      throw toError(error);
    }
  } catch (error) {
    logError("[notifications] Failed to create notification:", error);
  }
}

/* -------------------------------------- */
/* Domain event helpers                   */
/* -------------------------------------- */
/* Each call site below is where the meaningful event actually happens -   */
/* these helpers just centralize the copy/shape of the notification so     */
/* it's written once per event type, not duplicated at every call site.    */

export async function notifyPatientRegistered(patient: {
  id: string;
  first_name: string;
  last_name: string;
}) {
  await createNotification({
    title: "New patient registered",
    message: `${patient.first_name} ${patient.last_name} was added to your clinic.`,
    type: "patient",
    entity_type: "patient",
    entity_id: patient.id,
  });
}

export async function notifyAppointmentBooked(appointment: {
  id: string;
  treatment: string;
  appointment_date: string;
}) {
  await createNotification({
    title: "New appointment booked",
    message: `${appointment.treatment} scheduled for ${appointment.appointment_date}.`,
    type: "appointment",
    entity_type: "appointment",
    entity_id: appointment.id,
  });
}

export async function notifyAppointmentCancelled(appointment: {
  id: string;
  treatment: string;
  appointment_date: string;
}) {
  await createNotification({
    title: "Appointment cancelled",
    message: `${appointment.treatment} on ${appointment.appointment_date} was cancelled.`,
    type: "appointment",
    entity_type: "appointment",
    entity_id: appointment.id,
  });
}

export async function notifyAppointmentRescheduled(appointment: {
  id: string;
  treatment: string;
  appointment_date: string;
}) {
  await createNotification({
    title: "Appointment rescheduled",
    message: `${appointment.treatment} moved to ${appointment.appointment_date}.`,
    type: "appointment",
    entity_type: "appointment",
    entity_id: appointment.id,
  });
}

export async function notifyAppointmentCompleted(appointment: {
  id: string;
  treatment: string;
}) {
  await createNotification({
    title: "Appointment completed",
    message: `${appointment.treatment} was marked completed.`,
    type: "appointment",
    entity_type: "appointment",
    entity_id: appointment.id,
  });
}

export async function notifyInvoiceCreated(invoice: {
  id: string;
  invoice_number: string;
  total: number;
}) {
  await createNotification({
    title: "Invoice created",
    message: `Invoice ${invoice.invoice_number} for ${invoice.total} was created.`,
    type: "billing",
    entity_type: "invoice",
    entity_id: invoice.id,
  });
}

export async function notifyPaymentRecorded(invoice: {
  id: string;
  invoice_number: string;
  amount: number;
}) {
  await createNotification({
    title: "Payment recorded",
    message: `A payment of ${invoice.amount} was recorded for invoice ${invoice.invoice_number}.`,
    type: "billing",
    entity_type: "invoice",
    entity_id: invoice.id,
  });
}

export async function notifyStaffAdded(user: {
  id: string;
  full_name: string;
  role: string;
}) {
  await createNotification({
    title: "New staff member added",
    message: `${user.full_name} joined the clinic as ${user.role}.`,
    type: "staff",
    entity_type: "staff",
    entity_id: user.id,
  });
}

export async function notifyStaffRoleChanged(user: {
  id: string;
  full_name: string;
  role: string;
}) {
  await createNotification({
    title: "Staff role changed",
    message: `${user.full_name}'s role changed to ${user.role}.`,
    type: "staff",
    entity_type: "staff",
    entity_id: user.id,
    // Only the affected staff member needs a personal heads-up; everyone
    // else can already see role changes on the Users page.
    user_id: user.id,
  });
}

export async function notifyTreatmentPlanCreated(plan: {
  patient_id: string;
  title: string;
}) {
  await createNotification({
    title: "Treatment plan created",
    message: `"${plan.title}" was created.`,
    type: "treatment_plan",
    entity_type: "patient",
    entity_id: plan.patient_id,
  });
}

export async function notifyTreatmentCompleted(item: {
  patient_id: string;
  procedure: string;
}) {
  await createNotification({
    title: "Treatment completed",
    message: `${item.procedure} was marked completed.`,
    type: "treatment_plan",
    entity_type: "patient",
    entity_id: item.patient_id,
  });
}

/* -------------------------------------- */
/* Overdue invoices                       */
/* -------------------------------------- */
/* There's no cron/scheduled-job infrastructure in this project, so overdue */
/* invoices can't be detected the moment they become overdue. Instead this  */
/* is checked lazily once per admin session (see useNotifications), reusing */
/* clinic_invoices - no new table, no polling. Notifications already        */
/* created for an invoice are looked up first so re-checking never          */
/* duplicates them.                                                         */

const OVERDUE_AFTER_DAYS = 30;
const OVERDUE_TITLE = "Invoice overdue";

export async function checkOverdueInvoices(): Promise<void> {
  try {
    const clinicId = await getCurrentClinicId();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - OVERDUE_AFTER_DAYS);

    // Paged rather than a single unbounded fetch - a best-effort
    // background check, but still shouldn't silently miss overdue
    // invoices past the 1,000th row for a clinic with a genuinely large
    // unpaid backlog.
    const overdueInvoices = await fetchAllRows<{
      id: string;
      invoice_number: string;
      balance: number;
    }>((from, to) =>
      supabase
        .from("clinic_invoices")
        .select("id, invoice_number, balance")
        .eq("clinic_id", clinicId)
        .neq("status", "Paid")
        .lt("created_at", cutoff.toISOString())
        .range(from, to)
    ).catch(() => []);

    if (overdueInvoices.length === 0) {
      return;
    }

    const invoiceIds = overdueInvoices.map(
      (invoice) => invoice.id
    );

    const { data: existingNotifications } = await supabase
      .from("notifications")
      .select("entity_id")
      .eq("clinic_id", clinicId)
      .eq("entity_type", "invoice")
      .eq("title", OVERDUE_TITLE)
      .in("entity_id", invoiceIds);

    const alreadyNotified = new Set(
      (existingNotifications ?? []).map(
        (notification) => notification.entity_id
      )
    );

    const toNotify = overdueInvoices.filter(
      (invoice) => !alreadyNotified.has(invoice.id)
    );

    for (const invoice of toNotify) {
      await createNotification({
        title: OVERDUE_TITLE,
        message: `Invoice ${invoice.invoice_number} is overdue with a balance of ${invoice.balance}.`,
        type: "billing",
        entity_type: "invoice",
        entity_id: invoice.id,
      });
    }
  } catch (error) {
    logError("[notifications] Failed to check overdue invoices:", error);
  }
}
