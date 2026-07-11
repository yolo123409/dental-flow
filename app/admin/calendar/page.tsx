"use client";

import { useEffect, useState } from "react";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import { EventInput } from "@fullcalendar/core";

import { getCalendarAppointments } from "@/services/calendar";

export default function CalendarPage() {
  const [events, setEvents] = useState<EventInput[]>([]);

  useEffect(() => {
    loadAppointments();
  }, []);

  async function loadAppointments() {
    const today = new Date();

    const start = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    const end = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0
    );

    const appointments =
      await getCalendarAppointments(
        start.toISOString().split("T")[0],
        end.toISOString().split("T")[0]
      );

    const calendarEvents: EventInput[] =
      appointments.map((appointment) => ({
        id: appointment.id,

        title: appointment.patients
          ? `${appointment.patients.first_name} ${appointment.patients.last_name} • ${appointment.treatment}`
          : `Patient • ${appointment.treatment}`,

        start: `${appointment.appointment_date}T${appointment.appointment_time}`,

        color:
          appointment.status === "Completed"
            ? "#22c55e"
            : appointment.status === "Cancelled"
            ? "#ef4444"
            : "#3b82f6",
      }));

    setEvents(calendarEvents);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow">

      <FullCalendar
        plugins={[
          dayGridPlugin,
          timeGridPlugin,
          interactionPlugin,
        ]}
        initialView="dayGridMonth"
        height="auto"
        events={events}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right:
            "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        editable
        selectable
      />

    </div>
  );
}