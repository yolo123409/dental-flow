"use client";

import { useRef, useState } from "react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import {
  uploadPatientFile,
  saveAttachment,
} from "@/services/storage";

import { toast } from "sonner";

interface Attachment {
  id: string;
  title: string;
  file_type: string;
  file_url: string;
}

interface Props {
  patientId: string;
  files: Attachment[];
  onUploaded: () => Promise<void>;
}

export default function PatientDocuments({
  patientId,
  files,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] =
    useState(false);

  async function uploadFile(
    file: File
  ) {
    try {
      setUploading(true);

      const path =
        await uploadPatientFile(
          patientId,
          file
        );

      await saveAttachment(
        patientId,
        path,
        file
      );

      toast.success(
        "File uploaded successfully."
      );

      await onUploaded();

    } catch (error) {
      console.error(error);

      toast.error(
        "Upload failed."
      );

    } finally {
      setUploading(false);
    }
  }

  return (
    <Card title="Patient Documents">

      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const file =
            e.target.files?.[0];

          if (file) {
            uploadFile(file);
          }
        }}
      />

      <div className="space-y-4">

        {files.length === 0 ? (

          <div className="rounded-xl border border-dashed p-8 text-center text-slate-500">

            No files uploaded yet.

          </div>

        ) : (

          files.map((file) => (

            <div
              key={file.id}
              className="flex items-center justify-between rounded-xl bg-slate-50 p-4"
            >

              <div>

                <p className="font-semibold">

                  {file.title}

                </p>

                <p className="text-sm text-slate-500">

                  {file.file_type}

                </p>

              </div>

            </div>

          ))

        )}

        <Button
          disabled={uploading}
          onClick={() =>
            inputRef.current?.click()
          }
        >
          {uploading
            ? "Uploading..."
            : "+ Upload File"}
        </Button>

      </div>

    </Card>
  );
}