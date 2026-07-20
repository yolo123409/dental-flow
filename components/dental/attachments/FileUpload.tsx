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

      <Button
        disabled={uploading}
        onClick={() =>
          inputRef.current?.click()
        }
      >
        {uploading
          ? `Uploading ${current}/${total}`
          : "+ Upload"}
      </Button>
    </>
  );
}