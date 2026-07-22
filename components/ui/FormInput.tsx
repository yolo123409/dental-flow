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

      <label className="mb-2 block text-sm font-semibold text-graphite">
        {label}
      </label>

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus"
      />

    </div>
  );
}
