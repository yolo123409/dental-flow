import { FileImage, Camera, FileText, ClipboardCheck, FlaskConical } from "lucide-react";

import FeatureRow from "@/components/marketing/FeatureRow";

const folders = [
  { label: "Imaging", count: 6, icon: FileImage },
  { label: "Clinical Photos", count: 4, icon: Camera },
  { label: "Documents", count: 3, icon: FileText },
  { label: "Consent", count: 2, icon: ClipboardCheck },
  { label: "Lab Results", count: 1, icon: FlaskConical },
];

function DocumentsVisual() {
  return (
    <div className="rounded-2xl border border-sea-glass bg-enamel p-6 shadow-[0_24px_60px_-30px_rgba(23,85,82,0.3)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
        Patient files
      </p>

      <div className="mt-3 space-y-2">
        {folders.map((folder) => {
          const Icon = folder.icon;
          return (
            <div
              key={folder.label}
              className="flex items-center justify-between rounded-lg border border-sea-glass px-3.5 py-2.5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sea-glass text-eucalyptus">
                  <Icon size={14} />
                </div>
                <span className="text-sm font-medium text-graphite">
                  {folder.label}
                </span>
              </div>
              <span className="rounded-full bg-porcelain px-2.5 py-0.5 text-xs font-semibold text-mineral">
                {folder.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DocumentsShowcase() {
  return (
    <FeatureRow
      id="documents"
      eyebrow="Clinical Documents & Imaging"
      title="A secure home for every clinical file."
      description="X-rays, clinical photos, consent forms, and lab results - organized by patient and attached to the right record, so nothing is searched for across folders or inboxes."
      reverse
      visual={<DocumentsVisual />}
    />
  );
}
