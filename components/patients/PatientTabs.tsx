"use client";

interface Props {
  active: string;
  onChange: (tab: string) => void;
  hiddenTabs?: string[];
}

const tabs = [
  "Overview",
  "Dental Chart",
  "Treatment Plans",
  "Appointments",
  "Billing",
  "Timeline",
  "Clinical Notes",
];

export default function PatientTabs({
  active,
  onChange,
  hiddenTabs = [],
}: Props) {
  const visibleTabs = tabs.filter((tab) => !hiddenTabs.includes(tab));

  return (
    <div className="mb-8 flex gap-3 overflow-x-auto pb-1">

      {visibleTabs.map((tab) => (

        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`whitespace-nowrap rounded-xl px-5 py-3 font-medium transition ${
            active === tab
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-white text-slate-700 hover:bg-slate-100"
          }`}
        >
          {tab}
        </button>

      ))}

    </div>
  );
}