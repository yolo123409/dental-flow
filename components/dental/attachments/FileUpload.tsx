"use client";

import { useRef, useState } from "react";

import Button from "@/components/ui/Button";

import {
  uploadFile,
} from "@/services/patientToothFiles";

interface Props {
  patientId: string;
  toothNumber: number;
  folderId: string;
  onUploaded: () => Promise<void>;
}

const MAX_FILE_SIZE =
  100 * 1024 * 1024;

export default function FileUpload({
  patientId,
  toothNumber,
  folderId,
  onUploaded,
}: Props) {
  const inputRef =
    useRef<HTMLInputElement>(null);

  const [uploading, setUploading] =
    useState(false);

  const [current, setCurrent] =
    useState(0);

  const [total, setTotal] =
    useState(0);

  async function uploadFiles(
    files: FileList | File[]
  ) {
    if (!files.length) {
      return;
    }

    setUploading(true);

    setCurrent(0);

    setTotal(files.length);

    try {
      for (
        let i = 0;
        i < files.length;
        i++
      ) {
        const file =
          files[i];

        setCurrent(i + 1);

        if (
          file.size >
          MAX_FILE_SIZE
        ) {
          console.warn(
            `${file.name} skipped.`
          );
          continue;
        }

        try {
          await uploadFile(
            patientId,
            toothNumber,
            folderId,
            file
          );
        } catch (error) {
          console.error(
            file.name,
            error
          );
        }
      }

      await onUploaded();

    } finally {
      setUploading(false);

      setCurrent(0);

      setTotal(0);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function handleDrop(
    e: React.DragEvent<HTMLDivElement>
  ) {
    e.preventDefault();

    if (uploading) {
      return;
    }

    uploadFiles(
      e.dataTransfer.files
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        hidden
        multiple
        type="file"
        onChange={(e) => {
          if (e.target.files) {
            uploadFiles(
              e.target.files
            );
          }
        }}
      />

      <div
        onDragOver={(e) =>
          e.preventDefault()
        }
        onDrop={handleDrop}
        className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-blue-500 hover:bg-blue-50"
      >

        <div className="mb-4 text-5xl">
          📂
        </div>

        <h3 className="mb-2 text-lg font-semibold">
          Drag & Drop Files
        </h3>

        <p className="mb-5 text-sm text-slate-500">
          or choose one or multiple
          files from your computer.
        </p>

        <Button
          disabled={uploading}
          onClick={() =>
            inputRef.current?.click()
          }
        >
          {uploading
            ? `Uploading ${current} of ${total}`
            : "Choose Files"}
        </Button>

        {uploading && (

          <div className="mt-6">

            <div className="h-2 overflow-hidden rounded-full bg-slate-200">

              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{
                  width: `${
                    total === 0
                      ? 0
                      : (current /
                          total) *
                        100
                  }%`,
                }}
              />

            </div>

            <p className="mt-2 text-sm text-slate-500">

              Uploading {current} of{" "}
              {total}

            </p>

          </div>

        )}

      </div>

    </>
  );
}