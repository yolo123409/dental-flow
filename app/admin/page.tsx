export default function AdminDashboard() {
  return (
    <div>

      <h1 className="text-4xl font-bold">
        Welcome to Dental Flow
      </h1>

      <p className="mt-3 text-slate-600">
        Your admin dashboard is ready.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-slate-500">
            Patients
          </h2>

          <p className="mt-3 text-4xl font-bold">
            --
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-slate-500">
            Appointments
          </h2>

          <p className="mt-3 text-4xl font-bold">
            --
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-slate-500">
            Orders
          </h2>

          <p className="mt-3 text-4xl font-bold">
            --
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-slate-500">
            Revenue
          </h2>

          <p className="mt-3 text-4xl font-bold">
            KES --
          </p>
        </div>

      </div>

    </div>
  );
}