"use client";

import { ReactNode } from "react";
import Card from "./Card";

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
}: Props) {
  return (
    <Card className="overflow-hidden">

      <div className="flex items-start justify-between">

        <div>

          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
            {title}
          </p>

          <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
            {value}
          </h2>

          {subtitle && (
            <p className="mt-2 text-sm text-mineral">
              {subtitle}
            </p>
          )}

        </div>

        {icon && (
          <div className="rounded-lg bg-sea-glass p-3 text-eucalyptus">
            {icon}
          </div>
        )}

      </div>

    </Card>
  );
}
