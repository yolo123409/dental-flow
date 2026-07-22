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
      className={`rounded-lg border border-sea-glass bg-enamel ${className}`}
    >
      {title && (
        <div className="border-b border-sea-glass px-6 py-5">
          <h2 className="font-display text-xl font-bold">
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
