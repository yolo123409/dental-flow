"use client";

import { Suspense } from "react";
import CheckoutContent from "./CheckoutContent";

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100">
          <div className="rounded-xl bg-white p-8 shadow-xl">
            Loading checkout...
          </div>
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}