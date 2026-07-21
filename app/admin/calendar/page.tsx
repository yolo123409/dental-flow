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

  useEffect(() => {
    loadLookupData();
  }, []);

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

            let colour =
              "#3b82f6";

            if (
              appointment.status ===
              "Completed"
            ) {
              colour =
                "#22c55e";
            }

            if (
              appointment.status ===
              "Cancelled"
            ) {
              colour =
                "#ef4444";
            }

            return {
              id: appointment.id,

              title:
                appointment.patients
                  ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                  : "Patient",

              start: startDate,

              end: endDate,

              backgroundColor:
                colour,

              borderColor:
                colour,

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
            <div className="space-y-1 p-1 text-xs">

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

              <div className="text-[10px] uppercase tracking-wide opacity-70">
                {status}
              </div>

            </div>
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
          font-size: 1.25rem;
          font-weight: 700;
        }

        .fc .fc-button {
          border-radius: 0.75rem;
        }

        .fc .fc-daygrid-event,
        .fc .fc-timegrid-event {
          border: none;
          border-radius: 0.75rem;
          padding: 2px;
          cursor: pointer;
        }

        .fc .fc-event-main {
          padding: 2px;
        }

        .fc .fc-timegrid-slot {
          height: 3rem;
        }

        .fc .fc-highlight {
          background: rgba(59, 130, 246, 0.15);
        }

        .fc-theme-standard td,
        .fc-theme-standard th,
        .fc-theme-standard .fc-scrollgrid {
          border-color: #e5e7eb;
        }

        .fc .fc-day-today {
          background: rgba(59, 130, 246, 0.06) !important;
        }
      `}</style>

    </div>
  );
}