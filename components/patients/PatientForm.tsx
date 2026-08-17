"use client";

import {
  ACQUISITION_SOURCES,
  AcquisitionSource,
  PatientGender,
  REFERRAL_SOURCES,
  ReferralSource,
} from "@/types";

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
  acquisition_source: AcquisitionSource | null;
  referral_source: ReferralSource | null;
  referral_source_name: string;
}

export { ACQUISITION_SOURCES, REFERRAL_SOURCES };

type FormField = keyof PatientFormData;

interface Props {
  form: PatientFormData;
  onChange: (field: FormField, value: string) => void;
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

      <div className="border-t pt-4">

        <label className="mb-1 block text-sm font-medium text-slate-600">
          Acquisition Source
        </label>

        <p className="mb-2 text-xs text-slate-400">
          How this patient first came to the clinic. Operational metadata - optional.
        </p>

        <select
          className="rounded-lg border p-3"
          value={form.acquisition_source ?? ""}
          onChange={(e) =>
            onChange("acquisition_source", e.target.value)
          }
        >
          {form.acquisition_source === null && (
            <option value="">
              Not Recorded
            </option>
          )}

          {ACQUISITION_SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>

      </div>

      {form.acquisition_source === "Referral" && (
        <div className="grid gap-4 rounded-lg bg-slate-50 p-4">

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Referral Source
            </label>

            <select
              className="w-full rounded-lg border p-3"
              value={form.referral_source ?? ""}
              onChange={(e) =>
                onChange("referral_source", e.target.value)
              }
            >
              <option value="">
                Select Referral Source
              </option>

              {REFERRAL_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Referral Source Name
            </label>

            <input
              className="w-full rounded-lg border p-3"
              placeholder="e.g. John Mwangi, or Dr. Kamau (optional)"
              value={form.referral_source_name}
              onChange={(e) =>
                onChange("referral_source_name", e.target.value)
              }
            />
          </div>

        </div>
      )}

    </div>
  );
}
