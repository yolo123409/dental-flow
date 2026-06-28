export default function Stats() {
  return (
    <section className="bg-slate-900 py-20 text-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 text-center md:grid-cols-4">
        <div>
          <h2 className="text-5xl font-bold">24/7</h2>
          <p className="mt-2 text-slate-300">
            AI Availability
          </p>
        </div>

        <div>
          <h2 className="text-5xl font-bold">90%</h2>
          <p className="mt-2 text-slate-300">
            Less Admin Work
          </p>
        </div>

        <div>
          <h2 className="text-5xl font-bold">5×</h2>
          <p className="mt-2 text-slate-300">
            Faster Responses
          </p>
        </div>

        <div>
          <h2 className="text-5xl font-bold">100%</h2>
          <p className="mt-2 text-slate-300">
            Cloud Based
          </p>
        </div>
      </div>
    </section>
  );
}