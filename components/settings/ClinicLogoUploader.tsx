"use client";

import { useRef, useState } from "react";
import { ImageOff, Upload, X } from "lucide-react";

import Button from "@/components/ui/Button";

import {
  CLINIC_LOGO_ALLOWED_TYPES,
  CLINIC_LOGO_MAX_BYTES,
} from "@/services/settings";

interface Props {
  logoUrl: string | null;
  clinicName: string;
  uploading: boolean;
  removing: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

export default function ClinicLogoUploader({
  logoUrl,
  clinicName,
  uploading,
  removing,
  onUpload,
  onRemove,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = uploading || removing;

  function validateAndUpload(file: File) {
    setError(null);

    if (!CLINIC_LOGO_ALLOWED_TYPES.includes(file.type)) {
      setError("Please upload a PNG, JPG, WEBP, or SVG image.");
      return;
    }

    if (file.size > CLINIC_LOGO_MAX_BYTES) {
      setError("Logo must be smaller than 2MB.");
      return;
    }

    onUpload(file);
  }

  function handleFileInput(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (file) {
      validateAndUpload(file);
    }

    e.target.value = "";
  }

  function handleDrop(
    e: React.DragEvent<HTMLDivElement>
  ) {
    e.preventDefault();

    setDragging(false);

    if (busy) return;

    const file = e.dataTransfer.files?.[0];

    if (file) {
      validateAndUpload(file);
    }
  }

  return (
    <div>

      <label className="mb-2 block text-sm font-semibold text-graphite">
        Clinic Logo
        <span className="ml-1 text-xs font-normal text-mineral">
          (optional)
        </span>
      </label>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept={CLINIC_LOGO_ALLOWED_TYPES.join(",")}
        onChange={handleFileInput}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:flex-row sm:text-left ${
          dragging
            ? "border-eucalyptus bg-eucalyptus/5"
            : "border-sea-glass bg-porcelain"
        }`}
      >

        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sea-glass bg-enamel">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={clinicName}
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageOff
              size={24}
              className="text-mineral"
            />
          )}
        </div>

        <div className="flex-1">

          <p className="text-sm text-graphite">
            Drag and drop an image, or
          </p>

          <p className="text-xs text-mineral">
            PNG, JPG, WEBP, or SVG · up to 2MB
          </p>

        </div>

        <div className="flex shrink-0 gap-2">

          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={16} />
            {uploading
              ? "Uploading..."
              : logoUrl
              ? "Change Logo"
              : "Upload Logo"}
          </Button>

          {logoUrl && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={onRemove}
            >
              <X size={16} />
              {removing ? "Removing..." : "Remove"}
            </Button>
          )}

        </div>

      </div>

      {error && (
        <p className="mt-1.5 text-xs font-medium text-clay">
          {error}
        </p>
      )}

    </div>
  );
}
