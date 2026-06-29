"use client";

import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function PageContainer({
  children,
}: Props) {
  return (
    <main className="mx-auto max-w-7xl space-y-8 px-8 py-8">
      {children}
    </main>
  );
}