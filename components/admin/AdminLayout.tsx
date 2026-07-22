"use client";

import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type Props = {
  children: ReactNode;
};

export default function AdminLayout({
  children,
}: Props) {
  return (
    <div className="min-h-screen bg-porcelain">

      <Sidebar />

      <div className="ml-72">

        <Topbar />

        <main className="mx-auto max-w-[1440px] p-4 sm:p-6 xl:p-8">
          {children}
        </main>

      </div>

    </div>
  );
}
