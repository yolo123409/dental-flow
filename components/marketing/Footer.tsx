import Link from "next/link";

const productLinks = [
  { href: "#patients", label: "Patient Management" },
  { href: "#appointments", label: "Appointments" },
  { href: "#odontogram", label: "Odontogram" },
  { href: "#billing", label: "Billing" },
  { href: "#security", label: "Security" },
];

export default function Footer() {
  return (
    <footer className="bg-porcelain px-6 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <span className="font-display text-xl font-bold text-eucalyptus">
            Dental Flow
          </span>
          <p className="mt-3 max-w-xs text-sm leading-6 text-mineral">
            Dental practice management for clinics and multi-branch dental
            groups - patients, appointments, billing, and charting, in one
            connected system.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Product
          </p>
          <nav className="mt-3 flex flex-col gap-2.5">
            {productLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-graphite/80 transition-colors hover:text-eucalyptus"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Account
          </p>
          <nav className="mt-3 flex flex-col gap-2.5">
            <Link
              href="/auth/login"
              className="text-sm text-graphite/80 transition-colors hover:text-eucalyptus"
            >
              Log In
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm text-graphite/80 transition-colors hover:text-eucalyptus"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-sea-glass pt-6 text-sm text-mineral">
        &copy; {new Date().getFullYear()} Dental Flow
      </div>
    </footer>
  );
}
