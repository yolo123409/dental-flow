"use client";

import { Odontogram } from "react-odontogram";
import "react-odontogram/style.css";

export default function OdontogramPage() {
  return (
    <div className="min-h-screen bg-white p-10">

      <h1 className="mb-8 text-3xl font-bold">
        DentalFlow Odontogram
      </h1>

      <Odontogram
        showLabels
        theme="light"
        onChange={() => {}}
      />

    </div>
  );
}