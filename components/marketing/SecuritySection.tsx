import { ShieldCheck, Lock, GitBranch, DatabaseBackup, KeyRound, RefreshCw } from "lucide-react";

import Reveal from "@/components/marketing/Reveal";

const points = [
  {
    icon: ShieldCheck,
    title: "Role-based access",
    description:
      "Every staff member sees only what their role allows - front desk, dentist, accountant, and owner permissions are enforced throughout the system.",
  },
  {
    icon: GitBranch,
    title: "Branch-aware isolation",
    description:
      "Data is scoped to the branch and organization it belongs to. Staff at one branch don't see another branch's patients or records by default.",
  },
  {
    icon: Lock,
    title: "Protected clinical records",
    description:
      "Patient records, documents, and imaging are only reachable by authenticated, authorized staff - never exposed publicly.",
  },
  {
    icon: KeyRound,
    title: "Secure authentication",
    description:
      "Sign-in and session handling run on Supabase Auth, with private file storage for every document and image a clinic uploads.",
  },
  {
    icon: DatabaseBackup,
    title: "Encrypted, automated backups",
    description:
      "Database and file backups run automatically and are encrypted before they ever leave the system, with keys held independently of the backups themselves.",
  },
  {
    icon: RefreshCw,
    title: "Tested recovery procedures",
    description:
      "Restore procedures are actually rehearsed against real backups - not just assumed to work - so recovery is a tested process, not a hope.",
  },
];

export default function SecuritySection() {
  return (
    <section id="security" className="scroll-mt-24 border-y border-sea-glass bg-porcelain py-20 sm:py-28">
      <Reveal className="mx-auto max-w-2xl px-6 text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-eucalyptus">
          Security &amp; Reliability
        </span>
        <h2 className="mt-3 font-display text-3xl font-bold text-graphite text-balance sm:text-4xl">
          Practice data, treated seriously.
        </h2>
        <p className="mt-4 text-base leading-7 text-mineral text-pretty">
          Clinical and financial records deserve real safeguards. Here is
          what that means in DentalFlow, plainly stated.
        </p>
      </Reveal>

      <div className="mx-auto mt-14 grid max-w-5xl gap-5 px-6 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((point, index) => {
          const Icon = point.icon;
          return (
            <Reveal key={point.title} delay={index * 0.06}>
              <div className="h-full rounded-2xl border border-sea-glass bg-enamel p-6">
                <div className="inline-flex rounded-xl bg-sea-glass p-2.5 text-eucalyptus">
                  <Icon size={20} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-graphite">
                  {point.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-mineral">
                  {point.description}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
