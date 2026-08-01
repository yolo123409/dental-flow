"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";

import type {
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import CareRail from "@/components/ui/CareRail";

import {
  getCalendarAppointments,
  moveAppointment,
  resizeAppointment,
} from "@/services/calendar";

import {
  getAppointmentById,
} from "@/services/appointments";

import {
  getPatientOptions,
} from "@/services/patients";

import {
  getDentistOptions,
} from "@/services/dentists";

import AddAppointmentModal from "@/components/appointments/AddAppointmentModal";
import EditAppointmentModal from "@/components/appointments/EditAppointmentModal";

import type { Appointment } from "@/types/appointment";

import type {
  PatientOption,
  DentistOption,
} from "@/types/options";

export default function CalendarPage() {
  const [events, setEvents] =
    useState<EventInput[]>([]);

  const [patients, setPatients] =
    useState<PatientOption[]>([]);

  const [dentists, setDentists] =
    useState<DentistOption[]>([]);

  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);

  const [showAddModal, setShowAddModal] =
    useState(false);

  const [showEditModal, setShowEditModal] =
    useState(false);

  const [selectedDate, setSelectedDate] =
    useState("");

  const [selectedTime, setSelectedTime] =
    useState("");

  const [visibleStart, setVisibleStart] =
    useState<Date | null>(null);

  const [visibleEnd, setVisibleEnd] =
    useState<Date | null>(null);

  async function loadLookupData() {
    try {
      const [
        patientData,
        dentistData,
      ] = await Promise.all([
        getPatientOptions(),
        getDentistOptions(),
      ]);

      setPatients(patientData);
      setDentists(dentistData);
    } catch (error) {
      console.error(
        "Failed to load lookup data:",
        error
      );
    }
  }

  useEffect(() => {
    loadLookupData();
  }, []);

  async function loadAppointments(
    start: Date,
    end: Date
  ) {
    try {
      setVisibleStart(start);
      setVisibleEnd(end);

      const appointments =
        await getCalendarAppointments(
          start
            .toISOString()
            .split("T")[0],
          end
            .toISOString()
            .split("T")[0]
        );

      const mappedEvents: EventInput[] =
        appointments.map(
          (appointment) => {
            const startDate =
              new Date(
                `${appointment.appointment_date}T${appointment.appointment_time}`
              );

            const endDate =
              appointment.duration
                ? new Date(
                    startDate.getTime() +
                      appointment.duration *
                        60000
                  )
                : undefined;

            const statusColors = {
              Scheduled: { background: "#F5F0E9", border: "#9A6A27", text: "#795116" },
              Ongoing: { background: "#ECEFF2", border: "#3D6B8C", text: "#3D6B8C" },
              Completed: { background: "#EDF2F0", border: "#4D7C68", text: "#3E6555" },
              Cancelled: { background: "#F5EEEE", border: "#9B5550", text: "#86433F" },
              // Same clay/red family the app already uses for "did not
              // happen as planned" outcomes, kept visually distinguishable
              // from Cancelled via a solid (not implied-dashed) full-
              // opacity treatment plus the MISSED label text itself.
              Missed: { background: "#F5EEEE", border: "#9B5550", text: "#86433F" },
            } as const;
            const colour = statusColors[appointment.status] ?? statusColors.Scheduled;

            return {
              id: appointment.id,

              title:
                appointment.patients
                  ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                  : "Patient",

              start: startDate,

              end: endDate,

              backgroundColor: colour.background,
              borderColor: colour.border,
              textColor: colour.text,

              extendedProps: {
                treatment:
                  appointment.treatment,

                dentist:
                  appointment
                    .dentists
                    ?.full_name,

                status:
                  appointment.status,
              },
            };
          }
        );

      setEvents(mappedEvents);
    } catch (error) {
      console.error(
        "Failed to load appointments:",
        error
      );
    }
  }

    function handleDatesSet(
    arg: DatesSetArg
  ) {
    loadAppointments(
      arg.start,
      arg.end
    );
  }

  async function refreshCalendar() {
    if (
      !visibleStart ||
      !visibleEnd
    ) {
      return;
    }

    await loadAppointments(
      visibleStart,
      visibleEnd
    );
  }

  async function handleEventDrop(
    info: EventDropArg
  ) {
    try {
      await moveAppointment(
        info.event.id,
        info.event.start!,
        info.event.end
      );

      await refreshCalendar();
    } catch (error) {
      console.error(
        "Failed to move appointment:",
        error
      );

      info.revert();

      toast.error(
        "Unable to move appointment."
      );
    }
  }

  async function handleEventResize(
    info: unknown
  ) {
    const eventInfo = info as {
      event: {
        id: string;
        start: Date | null;
        end: Date | null;
      };
      revert: () => void;
    };

    try {
      if (
        !eventInfo.event.start ||
        !eventInfo.event.end
      ) {
        return;
      }

      await resizeAppointment(
        eventInfo.event.id,
        eventInfo.event.start,
        eventInfo.event.end
      );

      await refreshCalendar();
    } catch (error) {
      console.error(
        "Failed to resize appointment:",
        error
      );

      eventInfo.revert();

      toast.error(
        "Unable to resize appointment."
      );
    }
  }

  function handleDateSelect(
    selection: {
      start: Date;
    }
  ) {
    setSelectedDate(
      selection.start
        .toISOString()
        .split("T")[0]
    );

    setSelectedTime(
      selection.start
        .toTimeString()
        .slice(0, 5)
    );

    setShowAddModal(true);
  }

  async function handleEventClick(
    info: EventClickArg
  ) {
    try {
      const appointment =
        await getAppointmentById(
          info.event.id
        );

      if (!appointment) {
        return;
      }

      setSelectedAppointment(
        appointment
      );

      setShowEditModal(true);
    } catch (error) {
      console.error(
        "Failed to load appointment:",
        error
      );

      toast.error(
        "Unable to load appointment."
      );
    }
  }

  return (
    <div className="rounded-lg border border-sea-glass bg-enamel p-4 sm:p-6">

      <FullCalendar
        plugins={[
          dayGridPlugin,
          timeGridPlugin,
          interactionPlugin,
        ]}

        initialView="dayGridMonth"

        height="auto"

        events={events}

        datesSet={handleDatesSet}

        editable

        eventDurationEditable

        selectable

        eventDrop={handleEventDrop}

        eventResize={handleEventResize}

        select={handleDateSelect}

        eventClick={handleEventClick}

        nowIndicator

        weekends

        dayMaxEvents={3}

        expandRows

        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right:
            "dayGridMonth,timeGridWeek,timeGridDay",
        }}

        eventTimeFormat={{
          hour: "numeric",
          minute: "2-digit",
          meridiem: "short",
        }}

                eventContent={(eventInfo) => {
          const treatment =
            eventInfo.event.extendedProps
              .treatment;

          const dentist =
            eventInfo.event.extendedProps
              .dentist;

          const status =
            eventInfo.event.extendedProps
              .status;

          return (
            <CareRail status={status} className="space-y-1 py-1 text-xs" showLabel={false}>

              <div className="font-semibold">
                {eventInfo.timeText}
              </div>

              <div className="truncate font-medium">
                {eventInfo.event.title}
              </div>

              {treatment && (
                <div className="truncate opacity-90">
                  {treatment}
                </div>
              )}

              {dentist && (
                <div className="truncate opacity-75">
                  {dentist}
                </div>
              )}

              <div className="text-[10px] font-bold uppercase tracking-[0.08em] opacity-80">
                {status}
              </div>

            </CareRail>
          );
        }}

      />

      <AddAppointmentModal
        open={showAddModal}
        patients={patients}
        dentists={dentists}
        defaultDate={selectedDate}
        defaultTime={selectedTime}
        onClose={() => {
          setShowAddModal(false);
          setSelectedDate("");
          setSelectedTime("");
        }}
        onSuccess={async () => {
          await refreshCalendar();

          setShowAddModal(false);

          setSelectedDate("");
          setSelectedTime("");
        }}
      />

      <EditAppointmentModal
        open={showEditModal}
        appointment={selectedAppointment}
        patients={patients}
        dentists={dentists}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAppointment(null);
        }}
        onSuccess={async () => {
          await refreshCalendar();

          setShowEditModal(false);

          setSelectedAppointment(null);
        }}
      />
            <style jsx global>{`
        .fc .fc-toolbar-title {
          font-family: var(--font-fraunces), Georgia, serif;
          font-size: 1.25rem;
          font-weight: 700;
        }

        .fc .fc-button {
          border-radius: 0.5rem;
          background: #FFFFFF;
          border-color: #DCEAE6;
          color: #1D2B2A;
          box-shadow: none;
        }

        .fc .fc-daygrid-event,
        .fc .fc-timegrid-event {
          border-width: 1px;
          border-radius: 0.5rem;
          padding: 4px;
          cursor: pointer;
        }

        .fc .fc-event-main {
          padding: 2px;
        }

        .fc .fc-timegrid-slot {
          height: 3rem;
        }

        .fc .fc-highlight {
          background: #DCEAE6;
        }

        .fc-theme-standard td,
        .fc-theme-standard th,
        .fc-theme-standard .fc-scrollgrid {
          border-color: #DCEAE6;
        }

        .fc .fc-day-today {
          background: #F6F7F4 !important;
        }
      `}</style>

    </div>
  );
}
