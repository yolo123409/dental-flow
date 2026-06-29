"use client";

import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  title?: string;
}

export default function Card({
  children,
  className = "",
  title,
}: Props) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg ${className}`}
    >
      {title && (
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold">
            {title}
          </h2>
        </div>
      )}

      <div className="p-6">
        {children}
      </div>
    </div>
  );
}