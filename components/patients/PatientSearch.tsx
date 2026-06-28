"use client";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function PatientSearch({
  value,
  onChange,
}: Props) {
  return (
    <input
      className="w-full rounded-xl border p-4 shadow-sm"
      placeholder="🔍 Search patients..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}