export default function Hero() {
  return (
    <section className="flex min-h-[85vh] items-center justify-center bg-linear-to-b from-slate-50 to-white px-6">
      <div className="max-w-4xl text-center">
        <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-medium text-blue-700">
          AI Automation for Dental Clinics
        </span>

        <h1 className="mt-8 text-6xl font-extrabold tracking-tight text-slate-900">
          Grow Your Dental Practice With AI
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-slate-600">
          Dental Flow helps clinics automate appointment booking,
          patient follow-ups, WhatsApp communication, reviews,
          recalls and much more.
        </p>

        <div className="mt-10 flex justify-center gap-4">
          <button className="rounded-xl bg-blue-600 px-8 py-4 font-semibold text-white hover:bg-blue-700">
            Explore AI Systems
          </button>

          <button className="rounded-xl border border-slate-300 px-8 py-4 font-semibold hover:bg-slate-100">
            Book a Demo
          </button>
        </div>
      </div>
    </section>
  );
}