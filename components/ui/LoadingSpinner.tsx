"use client";

interface LoadingSpinnerProps {
  text?: string;
}

export default function LoadingSpinner({
  text = "Loading...",
}: LoadingSpinnerProps) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-sea-glass bg-enamel py-16">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-sea-glass border-t-eucalyptus" />

      <p className="mt-4 text-sm text-mineral">
        {text}
      </p>
    </div>
  );
}
