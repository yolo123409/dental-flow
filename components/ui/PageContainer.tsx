"use client";

import { ReactNode } from "react";

import Topbar from "@/components/layout/Topbar";

interface Props {
  children: ReactNode;
}

export default function PageContainer({
  children,
}: Props) {
  return (
    <main className="mx-auto max-w-7xl space-y-8 px-8 py-8">

      <Topbar />

      <div className="animate-in fade-in duration-500 space-y-8">

        {children}

      </div>

    </main>
  );
}