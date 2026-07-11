"use client";

import { PatientGender } from "@/types";

export interface PatientFormData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  gender: PatientGender | null;
  date_of_birth: string;
  address: string;
  allergies: string;
  medical_history: string;
}

interface Props {
  form: PatientFormData;
  onChange: (
    field: keyof PatientFormData,
    value: string
  ) => void;
}

export default function PatientForm({
  form,
  onChange,
}: Props) {
  return (
    <div className="grid gap-4">

      <input
        className="rounded-lg border p-3"
        placeholder="First Name"
        value={form.first_name}
        onChange={(e) =>
          onChange("first_name", e.target.value)
        }
      />

      <input
        className="rounded-lg border p-3"
        placeholder="Last Name"
        value={form.last_name}
        onChange={(e) =>
          onChange("last_name", e.target.value)
        }
      />

      <input
        className="rounded-lg border p-3"
        placeholder="Phone"
        value={form.phone}
        onChange={(e) =>
          onChange("phone", e.target.value)
        }
      />

      <input
        className="rounded-lg border p-3"
        placeholder="Email"
        value={form.email}
        onChange={(e) =>
          onChange("email", e.target.value)
        }
      />

      <select
        className="rounded-lg border p-3"
        value={form.gender ?? ""}
        onChange={(e) =>
          onChange("gender", e.target.value)
        }
      >
        <option value="">
          Select Gender
        </option>

        <option value="Male">
          Male
        </option>

        <option value="Female">
          Female
        </option>

        <option value="Other">
          Other
        </option>
      </select>

      <input
        type="date"
        className="rounded-lg border p-3"
        value={form.date_of_birth}
        onChange={(e) =>
          onChange("date_of_birth", e.target.value)
        }
      />

      <input
        className="rounded-lg border p-3"
        placeholder="Address"
        value={form.address}
        onChange={(e) =>
          onChange("address", e.target.value)
        }
      />

      <textarea
        className="rounded-lg border p-3"
        rows={3}
        placeholder="Allergies"
        value={form.allergies}
        onChange={(e) =>
          onChange("allergies", e.target.value)
        }
      />

      <textarea
        className="rounded-lg border p-3"
        rows={4}
        placeholder="Medical History"
        value={form.medical_history}
        onChange={(e) =>
          onChange("medical_history", e.target.value)
        }
      />

    </div>
  );
}