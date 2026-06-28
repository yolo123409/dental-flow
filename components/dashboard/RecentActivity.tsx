"use client";

import {
  UserPlus,
  CalendarPlus,
  Bot,
  CreditCard,
} from "lucide-react";

const activities = [
  {
    icon: UserPlus,
    title: "New patient registered",
    time: "10 minutes ago",
  },
  {
    icon: CalendarPlus,
    title: "Appointment booked",
    time: "35 minutes ago",
  },
  {
    icon: Bot,
    title: "AI receptionist answered a patient",
    time: "1 hour ago",
  },
  {
    icon: CreditCard,
    title: "Payment submitted",
    time: "2 hours ago",
  },
];

export default function RecentActivity() {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-xl font-bold">
        Recent Activity
      </h2>

      <div className="space-y-4">
        {activities.map((activity) => {
          const Icon = activity.icon;

          return (
            <div
              key={activity.title}
              className="flex items-center gap-4 rounded-xl border p-4"
            >
              <div className="rounded-xl bg-blue-100 p-3">
                <Icon className="text-blue-600" size={20} />
              </div>

              <div className="flex-1">
                <p className="font-semibold">
                  {activity.title}
                </p>

                <p className="text-sm text-slate-500">
                  {activity.time}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}