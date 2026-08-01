"use client";

interface Props {
  label: string;

  value: string;

  rows?: number;
  required?: boolean;
  error?: string | null;

  onChange: (
    value: string
  ) => void;
}

export default function FormTextarea({
  label,
  value,
  rows = 4,
  required = false,
  error = null,
  onChange,
}: Props) {
  return (
    <div>

      <label className="mb-2 block text-sm font-semibold text-graphite">
        {label}
        {required && (
          <span className="ml-1 text-clay">*</span>
        )}
      </label>

      <textarea
        rows={rows}
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className={`w-full rounded-lg border bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors focus:outline-none ${
          error
            ? "border-clay focus:border-clay"
            : "border-sea-glass hover:border-mineral/50 focus:border-eucalyptus"
        }`}
      />

      {error && (
        <p className="mt-1.5 text-xs font-medium text-clay">
          {error}
        </p>
      )}

    </div>
  );
}
