/**
 * Subtle dental-inspired background geometry, shared across marketing
 * sections. Deliberately faint (low opacity, currentColor/token strokes
 * only) so it reads as texture, not illustration.
 */

export function ArchCurve({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 300"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 280C20 120 180 20 400 20C620 20 780 120 780 280"
        stroke="var(--sea-glass)"
        strokeWidth="1.5"
      />
      <path
        d="M90 280C90 150 220 70 400 70C580 70 710 150 710 280"
        stroke="var(--sea-glass)"
        strokeWidth="1"
        strokeDasharray="2 8"
      />
    </svg>
  );
}

export function ToothMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M32 6C22 6 14 12 14 24c0 9 3 14 4.5 22 1 5.4 2.6 10 5 10 3 0 3.4-9 5.5-9s2.5 9 5.5 9c2.4 0 4-4.6 5-10C41 38 44 33 44 24 44 12 42 6 32 6Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function DentalGrid({ className }: { className?: string }) {
  return <div className={`mkt-fine-grid ${className ?? ""}`} aria-hidden="true" />;
}
