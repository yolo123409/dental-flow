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
      className={`rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${className}`}
    >
      {title && (
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-bold">
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