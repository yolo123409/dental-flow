import { ClinicSettings } from "@/services/settings";

interface Props {
  clinic: Pick<
    ClinicSettings,
    | "logo_url"
    | "clinic_name"
    | "address_line_1"
    | "address_line_2"
    | "city"
    | "country"
    | "phone"
    | "email"
    | "website"
  >;
}

/**
 * The clinic's identity - logo, name, address, and contact info - as it
 * should appear on any clinic-branded document (invoices today; receipts,
 * treatment-plan quotes, or other exports in the future). Reads only from
 * `services/settings.ts#getClinicSettings()`'s ClinicSettings shape, so
 * every consumer stays in sync with whatever the clinic configures in
 * Settings -> Clinic Profile - never hardcoded.
 */
export default function ClinicBrandingHeader({
  clinic,
}: Props) {
  return (
    <div>

      {clinic.logo_url && (

        <img
          src={
            clinic.logo_url
          }
          alt={
            clinic.clinic_name
          }
          className="mb-4 h-20 object-contain"
        />

      )}

      <h2 className="text-3xl font-bold">
        {
          clinic.clinic_name
        }
      </h2>

      {clinic.address_line_1 && (
        <p className="mt-2 text-slate-500">
          {
            clinic.address_line_1
          }
        </p>
      )}

      {clinic.address_line_2 && (
        <p className="text-slate-500">
          {
            clinic.address_line_2
          }
        </p>
      )}

      {(clinic.city ||
        clinic.country) && (
        <p className="text-slate-500">
          {[
            clinic.city,
            clinic.country,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}

      {clinic.phone && (
        <p className="text-slate-500">
          {clinic.phone}
        </p>
      )}

      {clinic.email && (
        <p className="text-slate-500">
          {clinic.email}
        </p>
      )}

      {clinic.website && (
        <p className="text-slate-500">
          {
            clinic.website
          }
        </p>
      )}

    </div>
  );
}
