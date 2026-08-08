"use client";

interface Props {
  onSelect: (accountType: "clinic" | "organization") => void;
}

export default function AccountTypeSelector({
  onSelect,
}: Props) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => onSelect("clinic")}
        className="w-full rounded-lg border border-sea-glass bg-enamel p-5 text-left transition-colors hover:border-eucalyptus hover:bg-porcelain"
      >
        <p className="font-display text-lg font-bold text-graphite">
          Independent Clinic
        </p>

        <p className="mt-1 text-sm text-mineral">
          A single dental clinic operating at one location.
        </p>
      </button>

      <button
        type="button"
        onClick={() => onSelect("organization")}
        className="w-full rounded-lg border border-sea-glass bg-enamel p-5 text-left transition-colors hover:border-eucalyptus hover:bg-porcelain"
      >
        <p className="font-display text-lg font-bold text-graphite">
          Dental Organization / Multi-Branch Group
        </p>

        <p className="mt-1 text-sm text-mineral">
          Manage multiple branches from one executive account.
        </p>
      </button>
    </div>
  );
}
