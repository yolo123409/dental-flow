"use client";

interface Props {
  label: string;
  value: string | number;
  type?: string;
  placeholder?: string;

  onChange: (
    value: string
  ) => void;
}

export default function FormInput({
  label,
  value,
  type = "text",
  placeholder,
  onChange,
}: Props) {
  return (
    <div>

      <label className="mb-2 block font-medium">
        {label}
      </label>

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
      />

    </div>
  );
}