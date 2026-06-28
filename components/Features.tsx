const features = [
  {
    title: "24/7 AI Receptionist",
    description:
      "Answer patient enquiries day and night without hiring extra staff.",
  },
  {
    title: "WhatsApp Automation",
    description:
      "Automatically send reminders, confirmations and follow-up messages.",
  },
  {
    title: "Appointment Booking",
    description:
      "Allow patients to book appointments online in seconds.",
  },
  {
    title: "Review Collection",
    description:
      "Automatically request Google reviews after successful appointments.",
  },
  {
    title: "Patient Recall",
    description:
      "Bring inactive patients back with intelligent recall campaigns.",
  },
  {
    title: "Analytics Dashboard",
    description:
      "Track appointments, revenue and AI performance from one dashboard.",
  },
];

export default function Features() {
  return (
    <section className="bg-white py-24 px-6">
      <div className="mx-auto max-w-7xl">
        <h2 className="text-center text-4xl font-bold">
          Everything Your Clinic Needs
        </h2>

        <p className="mt-4 text-center text-gray-600">
          Powerful AI tools built specifically for modern dental practices.
        </p>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border p-8 shadow-sm transition hover:shadow-lg"
            >
              <h3 className="text-2xl font-semibold">{feature.title}</h3>

              <p className="mt-4 text-gray-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}