"use client";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export default function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-sea-glass bg-enamel px-6 py-16 text-center">

      <h2 className="font-display text-2xl font-bold">
        {title}
      </h2>

      <p className="mx-auto mt-2 max-w-md text-sm text-mineral">
        {description}
      </p>

      {action && (
        <div className="mt-6">
          {action}
        </div>
      )}

    </div>
  );
}
