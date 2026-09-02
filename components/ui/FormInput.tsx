"use client";

import { useId } from "react";

interface Props {
  label: string;
  value: string | number;
  type?: string;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;

  onChange: (
    value: string
  ) => void;
}

export default function FormInput({
  label,
  value,
  type = "text",
  placeholder,
  required = false,
  error = null,
  disabled = false,
  onChange,
}: Props) {
  // Accessibility fix (found while testing H13): the label and input were
  // sibling elements with no programmatic association at all - a screen
  // reader announces this input with no name, and `getByLabelText` in
  // tests can never find it either. useId() gives each instance its own
  // stable id without callers needing to pass one.
  const inputId = useId();

  return (
    <div>

      <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-graphite">
        {label}
        {required && (
          <span className="ml-1 text-clay">*</span>
        )}
      </label>

      <input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className={`min-h-11 w-full rounded-lg border bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
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
