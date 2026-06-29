"use client";

export interface DentistFormData {
  full_name: string;
  specialty: string;
  email: string;
  phone: string;
  active: boolean;
}

interface DentistFormProps {
  form: DentistFormData;

  onChange: (
    field: keyof DentistFormData,
    value: string | boolean
  ) => void;
}

export default function DentistForm({
  form,
  onChange,
}: DentistFormProps) {
  return (
    <div className="space-y-5">

      <div>

        <label className="mb-2 block font-medium">
          Full Name
        </label>

        <input
          value={form.full_name}
          onChange={(e) =>
            onChange("full_name", e.target.value)
          }
          className="w-full rounded-xl border p-3"
          placeholder="Dr. John Doe"
        />

      </div>

      <div>

        <label className="mb-2 block font-medium">
          Specialty
        </label>

        <input
          value={form.specialty}
          onChange={(e) =>
            onChange("specialty", e.target.value)
          }
          className="w-full rounded-xl border p-3"
          placeholder="General Dentist"
        />

      </div>

      <div className="grid gap-5 md:grid-cols-2">

        <div>

          <label className="mb-2 block font-medium">
            Email
          </label>

          <input
            type="email"
            value={form.email}
            onChange={(e) =>
              onChange("email", e.target.value)
            }
            className="w-full rounded-xl border p-3"
            placeholder="doctor@clinic.com"
          />

        </div>

        <div>

          <label className="mb-2 block font-medium">
            Phone
          </label>

          <input
            value={form.phone}
            onChange={(e) =>
              onChange("phone", e.target.value)
            }
            className="w-full rounded-xl border p-3"
            placeholder="+254..."
          />

        </div>

      </div>

      <div>

        <label className="mb-2 flex items-center gap-3 font-medium">

          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) =>
              onChange("active", e.target.checked)
            }
          />

          Active Dentist

        </label>

      </div>

    </div>
  );
}