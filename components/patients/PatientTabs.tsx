"use client";

interface Props {
  active: string;
  onChange: (tab: string) => void;
}

const tabs = [
  "Overview",
  "Dental Chart",
  "Appointments",
  "Billing",
  "Timeline",
];

export default function PatientTabs({
  active,
  onChange,
}: Props) {
  return (
    <div className="mb-8 flex gap-3 overflow-x-auto">

      {tabs.map((tab) => (

        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`rounded-xl px-5 py-3 font-medium transition ${
            active === tab
              ? "bg-blue-600 text-white"
              : "bg-white hover:bg-slate-100"
          }`}
        >
          {tab}
        </button>

      ))}

    </div>
  );
}