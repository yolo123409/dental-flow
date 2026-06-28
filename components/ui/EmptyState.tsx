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
    <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white py-16 text-center">

      <h2 className="text-2xl font-bold">
        {title}
      </h2>

      <p className="mt-2 text-slate-500">
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