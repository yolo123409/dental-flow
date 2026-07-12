"use client";

interface Props {
  item: {
    id: string;

    condition: string;

    diagnosis: string | null;

    treatment: string | null;

    treatment_status: string | null;

    materials: string | null;

    estimated_cost: number | null;

    notes: string | null;

    created_at: string;
  };
}

export default function HistoryCard({
  item,
}: Props) {
  const materials =
    item.materials
      ?.split("\n")
      .map((m) => m.trim())
      .filter(Boolean) ?? [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">

        <div>

          <div className="flex items-center gap-2">

            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
              {item.condition}
            </span>

            {item.treatment_status && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                {item.treatment_status}
              </span>
            )}

          </div>

        </div>

        <span className="text-sm text-slate-500">
          {new Date(
            item.created_at
          ).toLocaleString()}
        </span>

      </div>

      <div className="space-y-5">

        {item.diagnosis && (
          <section>

            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Diagnosis
            </h4>

            <p className="whitespace-pre-wrap text-slate-700">
              {item.diagnosis}
            </p>

          </section>
        )}

        {item.treatment && (
          <section>

            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Treatment
            </h4>

            <p className="whitespace-pre-wrap text-slate-700">
              {item.treatment}
            </p>

          </section>
        )}

        {materials.length > 0 && (
          <section>

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Materials Used
            </h4>

            <div className="flex flex-wrap gap-2">

              {materials.map(
                (material) => (
                  <span
                    key={material}
                    className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                  >
                    {material}
                  </span>
                )
              )}

            </div>

          </section>
        )}

        {item.estimated_cost !==
          null && (
          <section>

            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estimated Cost
            </h4>

            <p className="font-semibold text-emerald-600">
              KES{" "}
              {Number(
                item.estimated_cost
              ).toLocaleString()}
            </p>

          </section>
        )}

        {item.notes && (
          <section>

            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Clinical Notes
            </h4>

            <p className="whitespace-pre-wrap text-slate-700">
              {item.notes}
            </p>

          </section>
        )}

      </div>

    </div>
  );
}