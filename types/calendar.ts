import { Appointment } from "./appointment";

export interface CalendarDayData {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  appointments: Appointment[];
}

export type CalendarView =
  | "month"
  | "week"
  | "day";