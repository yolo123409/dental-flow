// Kenyan phone normalization is deliberately its own small function rather
// than a general international parser - DentalFlow only serves Kenyan
// clinics today. Extending to other countries later means adding another
// branch here, not rewriting this module.
export function normalizeKenyanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digits = raw.replace(/[^\d+]/g, "");

  let national: string | null = null;

  if (digits.startsWith("+254")) {
    national = digits.slice(4);
  } else if (digits.startsWith("254")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.startsWith("7") || digits.startsWith("1")) {
    national = digits;
  } else {
    return null;
  }

  // Kenyan mobile numbers: 9 digits after the country code, starting with
  // 7 (Safaricom/Airtel/Telkom) or 1 (newer Safaricom ranges).
  if (!/^[71]\d{8}$/.test(national)) {
    return null;
  }

  return `254${national}`;
}

interface ReminderMessageInput {
  patientFirstName: string;
  clinicName: string;
  treatment: string;
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime: string; // HH:MM
  clinicPhone?: string | null;
}

// appointment_date/appointment_time are stored as plain clinic-local
// wall-clock values (no UTC instant anywhere in this schema - confirmed
// across services/appointments.ts and the calendar). Parsing them with
// Date.UTC + formatting with timeZone: "UTC" guarantees the displayed
// date/time always matches the stored values exactly, regardless of the
// browser or server's own local timezone - there is no real conversion to
// perform since the values are already clinic-local by construction.
function parseAppointmentDateTime(appointmentDate: string, appointmentTime: string): Date {
  const [year, month, day] = appointmentDate.split("-").map(Number);
  const [hour, minute] = appointmentTime.split(":").map(Number);

  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0));
}

export function formatAppointmentDateTime(appointmentDate: string, appointmentTime: string) {
  const dt = parseAppointmentDateTime(appointmentDate, appointmentTime);

  const datePart = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(dt);

  return { datePart, timePart };
}

export function buildReminderMessage(input: ReminderMessageInput): string {
  const { datePart, timePart } = formatAppointmentDateTime(
    input.appointmentDate,
    input.appointmentTime
  );

  const contactLine = input.clinicPhone
    ? `We look forward to seeing you. If you need to reschedule, please contact us at ${input.clinicPhone}.`
    : "We look forward to seeing you. If you need to reschedule, please contact the clinic.";

  return [
    `Hello ${input.patientFirstName}, this is a reminder from ${input.clinicName} about your upcoming appointment.`,
    "",
    `Appointment: ${input.treatment}`,
    `Date: ${datePart}`,
    `Time: ${timePart}`,
    "",
    contactLine,
  ].join("\n");
}

export function buildWhatsAppLink(normalizedPhone: string, message: string): string {
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
