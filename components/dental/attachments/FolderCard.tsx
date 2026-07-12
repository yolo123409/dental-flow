"use client";

import { useState } from "react";

import {
  ToothFolder,
} from "@/services/patientToothFolders";

function getFolderIcon(
  name: string
) {
  const value =
    name.toLowerCase();

  if (
    value.includes("xray") ||
    value.includes("x-ray")
  ) {
    return "🩻";
  }

  if (
    value.includes("photo") ||
    value.includes("image")
  ) {
    return "📷";
  }

  if (
    value.includes("consent")
  ) {
    return "📝";
  }

  if (
    value.includes("implant")
  ) {
    return "🦷";
  }

  if (
    value.includes("lab")
  ) {
    return "🧪";
  }

  if (
    value.includes("invoice")
  ) {
    return "💳";
  }

  if (
    value.includes("scan")
  ) {
    return "📡";
  }

  return "📁";
}

interface Props {
  folder: ToothFolder;

  onOpen: (
    folder: ToothFolder
  ) => void;

  onRename: (
    folder: ToothFolder
  ) => void;

  onDelete: (
    folder: ToothFolder
  ) => void;
}

export default function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] =
    useState(false);

  const fileCount =
    folder.patient_tooth_files
      ?.length ?? 0;

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">

      <button
        onClick={() =>
          onOpen(folder)
        }
        className="flex w-full items-center gap-4 p-4 text-left"
      >

        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-3xl">

          {getFolderIcon(
            folder.folder_name
          )}

        </div>

        <div className="min-w-0 flex-1">

          <h3 className="truncate font-semibold">
            {folder.folder_name}
          </h3>

          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">

            <span>
              {fileCount} file
              {fileCount !== 1
                ? "s"
                : ""}
            </span>

            {folder
              .patient_tooth_files?.[0]
              ?.uploaded_at && (

              <span>

                • Updated{" "}

                {new Date(
                  folder
                    .patient_tooth_files[0]
                    .uploaded_at
                ).toLocaleDateString()}

              </span>

            )}

          </div>

        </div>

      </button>

      <button
        onClick={() =>
          setMenuOpen(
            !menuOpen
          )
        }
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-slate-100"
      >
        ⋮
      </button>

      {menuOpen && (

        <div className="absolute right-3 top-14 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">

          <button
            onClick={() => {
              setMenuOpen(false);
              onRename(folder);
            }}
            className="block w-full px-4 py-3 text-left transition hover:bg-slate-100"
          >
            ✏️ Rename
          </button>

          <button
            onClick={() => {
              setMenuOpen(false);
              onDelete(folder);
            }}
            className="block w-full px-4 py-3 text-left text-red-600 transition hover:bg-red-50"
          >
            🗑 Delete
          </button>

        </div>

      )}

    </div>
  );
}