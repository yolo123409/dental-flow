"use client";

import { Building2, Network, LucideIcon } from "lucide-react";

export type ClinicType = "independent" | "multi-branch";

interface Option {
  type: ClinicType;
  icon: LucideIcon;
  title: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    type: "independent",
    icon: Building2,
    title: "Independent Clinic",
    description: "Manage one clinic with the standard Dental Flow setup.",
  },
  {
    type: "multi-branch",
    icon: Network,
    title: "Multi-Branch Organization",
    description: "Manage multiple clinic branches from one organization.",
  },
];

interface Props {
  onSelect: (type: ClinicType) => void;
}

export default function ClinicTypeSelector({ onSelect }: Props) {
  return (
    <div className="space-y-3">
      {OPTIONS.map((option) => {
        const Icon = option.icon;

        return (
          <button
            key={option.type}
            type="button"
            onClick={() => onSelect(option.type)}
            className="flex w-full items-start gap-4 rounded-lg border border-sea-glass bg-enamel p-5 text-left transition-colors hover:border-eucalyptus hover:bg-porcelain"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sea-glass/60 text-eucalyptus">
              <Icon size={22} />
            </span>

            <span>
              <span className="block font-semibold text-graphite">
                {option.title}
              </span>

              <span className="mt-1 block text-sm text-mineral">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
