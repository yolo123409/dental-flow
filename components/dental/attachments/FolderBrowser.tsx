"use client";

import FolderCard from "./FolderCard";

import {
  ToothFolder,
} from "@/services/patientToothFolders";

interface Props {
  folders: ToothFolder[];
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

export default function FolderBrowser({
  folders,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  if (folders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">

        <div className="mb-4 text-6xl">
          📁
        </div>

        <h3 className="text-xl font-semibold">
          No folders yet
        </h3>

        <p className="mt-2 text-slate-500">
          Create your first folder to
          organize x-rays, clinical
          photos, PDFs and other files.
        </p>

      </div>
    );
  }

  return (
    <div className="space-y-4">

      {folders.map((folder) => (

        <FolderCard
          key={folder.id}
          folder={folder}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
        />

      ))}

    </div>
  );
}