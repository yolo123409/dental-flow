"use client";

interface Props {
  label: string;

  value: string;

  rows?: number;

  onChange: (
    value: string
  ) => void;
}

export default function FormTextarea({
  label,
  value,
  rows = 4,
  onChange,
}: Props) {
  return (
    <div>

      <label className="mb-2 block font-medium">
        {label}
      </label>

      <textarea
        rows={rows}
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
      />

    </div>
  );
}