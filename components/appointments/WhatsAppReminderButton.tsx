"use client";

import { MessageCircle } from "lucide-react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

// A raw <button> rather than the shared Button component - Button only
// offers primary/secondary/danger/quiet variants (none of them green), and
// layering a green background on top via className is unreliable because
// Tailwind's cascade order (not the order classes appear in the DOM
// attribute) decides which "bg-*" utility wins. Shape/sizing still matches
// Button's own conventions so it reads as part of the same UI kit.
export default function WhatsAppReminderButton({
  onClick,
  disabled = false,
  disabledReason,
  className = "",
}: Props) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-green-600/30 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-green-50"
      >
        <MessageCircle size={16} />
        Appointment Reminder
      </button>

      {disabled && disabledReason && (
        <p className="mt-1.5 text-xs text-mineral">
          {disabledReason}
        </p>
      )}
    </div>
  );
}
