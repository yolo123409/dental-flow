import FeatureRow from "@/components/marketing/FeatureRow";

const columns = [
  {
    dentist: "Dr. A",
    slots: [
      { time: "09:00", label: "Patient 001", tone: "eucalyptus" },
      { time: "11:00", label: "Patient 002", tone: "harbor" },
    ],
  },
  {
    dentist: "Dr. B",
    slots: [
      { time: "09:30", label: "Patient 003", tone: "sage" },
      { time: "10:30", label: "Patient 004", tone: "eucalyptus" },
      { time: "13:00", label: "Patient 005", tone: "harbor" },
    ],
  },
  {
    dentist: "Dr. C",
    slots: [{ time: "10:00", label: "Patient 006", tone: "sage" }],
  },
];

const toneMap: Record<string, string> = {
  eucalyptus: "bg-sea-glass text-deep-eucalyptus",
  harbor: "bg-pale-harbor text-harbor",
  sage: "bg-pale-sage text-sage-ink",
};

function CalendarVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-semibold text-graphite">
          Tuesday, Karen Branch
        </p>
        <span className="rounded-full bg-porcelain px-3 py-1 text-xs font-semibold text-mineral">
          6 appointments
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {columns.map((col) => (
          <div key={col.dentist}>
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-mineral">
              {col.dentist}
            </p>
            <div className="mt-2 space-y-2">
              {col.slots.map((slot) => (
                <div
                  key={slot.time + slot.label}
                  className={`rounded-lg px-2.5 py-2 text-xs font-medium ${toneMap[slot.tone]}`}
                >
                  <p className="data-metric font-semibold">{slot.time}</p>
                  <p className="truncate">{slot.label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AppointmentsShowcase() {
  return (
    <FeatureRow
      id="appointments"
      eyebrow="Appointments & Calendar"
      title="Make every appointment count."
      description="A clear, branch-aware calendar for every dentist - book, reschedule, and see the whole day at a glance, without double-booking chairs or clinicians."
      reverse
      visual={<CalendarVisual />}
    />
  );
}
