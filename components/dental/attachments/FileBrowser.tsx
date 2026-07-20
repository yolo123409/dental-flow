"use client";

import { useEffect, useMemo, useState } from "react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import FileUpload from "./FileUpload";
import FileCard from "./FileCard";

import {
  ToothFile,
  canPreview,
  deleteFile,
  getFiles,
  getSignedUrl,
  isImage,
  renameFile,
} from "@/services/patientToothFiles";

interface Props {
  patientId: string;
  toothNumber: number;
  folderId: string;
}

export default function FileBrowser({
  patientId,
  toothNumber,
  folderId,
}: Props) {
  const [files, setFiles] =
    useState<ToothFile[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

  const [previewFile, setPreviewFile] =
    useState<ToothFile | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);

  const [deleteFileTarget, setDeleteFileTarget] =
    useState<ToothFile | null>(null);

  const [deleting, setDeleting] =
    useState(false);

  const [viewMode, setViewMode] =
    useState<"grid" | "list">("grid");

  const [sortBy, setSortBy] =
    useState<"name" | "date" | "size">(
      "date"
    );

  const [ascending, setAscending] =
    useState(false);

  const [renameTarget, setRenameTarget] =
    useState<ToothFile | null>(null);

  const [newFileName, setNewFileName] =
    useState("");

  const [renaming, setRenaming] =
    useState(false);

  async function loadFiles() {
    try {
      setLoading(true);

      const result =
        await getFiles(folderId);

      setFiles(result);

    } catch (error) {
      console.error(error);
      alert("Failed to load files.");

    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles();
  }, [folderId]);

  async function openFile(
    file: ToothFile
  ) {
    try {
      const signed =
        await getSignedUrl(
          file.file_url
        );

      if (canPreview(file)) {
        setPreviewFile(file);
        setPreviewUrl(signed);
      } else {
        window.open(
          signed,
          "_blank"
        );
      }

    } catch (error) {
      console.error(error);
      alert(
        "Unable to open file."
      );
    }
  }

  async function downloadFile(
    file: ToothFile
  ) {
    try {
      const signedUrl =
        await getSignedUrl(
          file.file_url
        );

      const link =
        document.createElement("a");

      link.href = signedUrl;
      link.download =
        file.file_name;

      document.body.appendChild(
        link
      );

      link.click();

      document.body.removeChild(
        link
      );

    } catch (error) {
      console.error(error);

      alert(
        "Unable to download file."
      );
    }
  }

    async function confirmDelete() {
    if (!deleteFileTarget) {
      return;
    }

    try {
      setDeleting(true);

      await deleteFile(
        deleteFileTarget
      );

      if (
        previewFile?.id ===
        deleteFileTarget.id
      ) {
        setPreviewFile(null);
        setPreviewUrl(null);
      }

      setDeleteFileTarget(
        null
      );

      await loadFiles();

    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }

    } finally {
      setDeleting(false);
    }
  }

  async function confirmRename() {
    if (!renameTarget) {
      return;
    }

    const clean =
      newFileName.trim();

    if (!clean) {
      alert(
        "Please enter a file name."
      );
      return;
    }

    try {
      setRenaming(true);

      await renameFile(
        renameTarget.id,
        clean
      );

      setRenameTarget(null);
      setNewFileName("");

      await loadFiles();

    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }

    } finally {
      setRenaming(false);
    }
  }

  function formatSize(
    bytes: number | null
  ) {
    if (!bytes) return "-";

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (
      bytes <
      1024 * 1024
    ) {
      return `${(
        bytes / 1024
      ).toFixed(1)} KB`;
    }

    return `${(
      bytes /
      1024 /
      1024
    ).toFixed(2)} MB`;
  }

  const filtered =
    useMemo(() => {
      const result =
        files.filter((file) =>
          file.file_name
            .toLowerCase()
            .includes(
              search.toLowerCase()
            )
        );

      result.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case "name":
            comparison =
              a.file_name.localeCompare(
                b.file_name
              );
            break;

          case "date":
            comparison =
              new Date(
                a.uploaded_at
              ).getTime() -
              new Date(
                b.uploaded_at
              ).getTime();
            break;

          case "size":
            comparison =
              (a.file_size ?? 0) -
              (b.file_size ?? 0);
            break;
        }

        return ascending
          ? comparison
          : -comparison;
      });

      return result;
    }, [
      files,
      search,
      sortBy,
      ascending,
    ]);

  return (
    <>
      <div className="space-y-6">

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">

          <div className="flex items-center gap-3">

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as
                    | "name"
                    | "date"
                    | "size"
                )
              }
              className="rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="date">
                Sort by Date
              </option>

              <option value="name">
                Sort by Name
              </option>

              <option value="size">
                Sort by Size
              </option>
            </select>

            <Button
              variant="secondary"
              onClick={() =>
                setAscending(
                  !ascending
                )
              }
            >
              {ascending
                ? "↑ Asc"
                : "↓ Desc"}
            </Button>

          </div>

          <div className="flex items-center gap-2">

            <FileUpload
              patientId={patientId}
              toothNumber={toothNumber}
              folderId={folderId}
              onUploaded={loadFiles}
            />

            <Button
              variant={
                viewMode ===
                "grid"
                  ? "primary"
                  : "secondary"
              }
              onClick={() =>
                setViewMode(
                  "grid"
                )
              }
            >
              Grid
            </Button>

            <Button
              variant={
                viewMode ===
                "list"
                  ? "primary"
                  : "secondary"
              }
              onClick={() =>
                setViewMode(
                  "list"
                )
              }
            >
              List
            </Button>

          </div>

        </div>

                {loading ? (

          <Card>

            <div className="py-16 text-center">
              Loading...
            </div>

          </Card>

        ) : filtered.length === 0 ? (

          <Card>

            <div className="py-16 text-center">

              <div className="mb-4 text-6xl">
                📂
              </div>

              <h3 className="text-xl font-semibold">
                No files yet
              </h3>

              <p className="mt-2 text-slate-500">
                Upload the first file to this
                folder.
              </p>

              <div className="mt-6 flex justify-center">

                <FileUpload
                  patientId={patientId}
                  toothNumber={toothNumber}
                  folderId={folderId}
                  onUploaded={loadFiles}
                />

              </div>

            </div>

          </Card>

        ) : (

          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-2 gap-5 lg:grid-cols-4"
                : "space-y-4"
            }
          >

            {filtered.map((file) => (

              <FileCard
                key={file.id}
                file={file}
                viewMode={viewMode}
                formatSize={formatSize}
                onOpen={openFile}
                onDownload={downloadFile}
                onRename={(file) => {
                  setRenameTarget(file);
                  setNewFileName(
                    file.file_name
                  );
                }}
                onDelete={
                  setDeleteFileTarget
                }
              />

            ))}

          </div>

        )}

      </div>

      {previewFile &&
        previewUrl && (

          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">

            <div className="relative max-h-[90vh] w-full max-w-7xl rounded-2xl bg-white p-6">

              <button
                onClick={() => {
                  setPreviewFile(
                    null
                  );
                  setPreviewUrl(
                    null
                  );
                }}
                className="absolute right-6 top-6 text-4xl"
              >
                ×
              </button>

              <h2 className="mb-5 text-xl font-semibold">
                {
                  previewFile.file_name
                }
              </h2>

              {isImage(
                previewFile
              ) ? (

                <img
                  src={previewUrl}
                  className="mx-auto max-h-[78vh] rounded-xl"
                />

              ) : (

                <iframe
                  src={previewUrl}
                  className="h-[78vh] w-full rounded-xl"
                />

              )}

            </div>

          </div>

      )}

            {renameTarget && (

        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">

          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">

            <div className="border-b border-slate-200 px-6 py-5">

              <h2 className="text-xl font-semibold">
                Rename File
              </h2>

            </div>

            <div className="p-6">

              <input
                autoFocus
                value={newFileName}
                onChange={(e) =>
                  setNewFileName(
                    e.target.value
                  )
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter"
                  ) {
                    confirmRename();
                  }
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
              />

            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-5">

              <Button
                variant="secondary"
                onClick={() => {
                  setRenameTarget(
                    null
                  );
                  setNewFileName("");
                }}
              >
                Cancel
              </Button>

              <Button
                disabled={renaming}
                onClick={
                  confirmRename
                }
              >
                {renaming
                  ? "Saving..."
                  : "Save"}
              </Button>

            </div>

          </div>

        </div>

      )}

      {deleteFileTarget && (

        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">

          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

            <h2 className="mb-3 text-xl font-semibold">
              Delete File
            </h2>

            <p className="mb-6 text-slate-600">

              Are you sure you want to permanently delete

              <span className="font-semibold">
                {" "}
                {deleteFileTarget.file_name}
              </span>

              ?

            </p>

            <div className="flex justify-end gap-3">

              <Button
                variant="secondary"
                onClick={() =>
                  setDeleteFileTarget(
                    null
                  )
                }
              >
                Cancel
              </Button>

              <Button
                variant="danger"
                disabled={deleting}
                onClick={
                  confirmDelete
                }
              >
                {deleting
                  ? "Deleting..."
                  : "Delete"}
              </Button>

            </div>

          </div>

        </div>

      )}

    </>
  );
}