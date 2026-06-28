import { tool } from "ai";
import { z } from "zod";

import { createAppointment } from "@/lib/booking";

export const createAppointmentTool = tool({
  description: "Book a dental appointment.",

  inputSchema: z.object({
    patientName: z.string(),

    patientEmail: z.string().optional(),

    patientPhone: z.string().optional(),

    treatment: z.string().optional(),

    appointmentDate: z.string(),

    appointmentTime: z.string(),
  }),

  execute: async ({
    patientName,
    patientEmail,
    patientPhone,
    treatment,
    appointmentDate,
    appointmentTime,
  }) => {
    return createAppointment(
      patientName,
      patientEmail ?? "",
      patientPhone ?? "",
      treatment ?? "",
      appointmentDate,
      appointmentTime
    );
  },
});