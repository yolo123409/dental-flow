"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";

import FolderBrowser from "./FolderBrowser";
import FileBrowser from "./FileBrowser";

import {
  ToothFolder,
  createFolder,
  deleteFolder,
  getFolders,
  renameFolder,
} from "@/services/patientToothFolders";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  patientId: string;
  toothNumber: number;
}

export default function ToothAttachments({
  patientId,
  toothNumber,
}: Props) {
  const [folders, setFolders] =
    useState<ToothFolder[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [selectedFolder, setSelectedFolder] =
    useState<ToothFolder | null>(null);

  const [showCreateModal, setShowCreateModal] =
    useState(false);

  const [showRenameModal, setShowRenameModal] =
    useState(false);

  const [showDeleteModal, setShowDeleteModal] =
    useState(false);

  const [folderName, setFolderName] =
    useState("");

  const [activeFolder, setActiveFolder] =
    useState<ToothFolder | null>(null);

  const [saving, setSaving] =
    useState(false);

  const [search] =
  useState("");

  async function loadFolders() {
    try {
      setLoading(true);

      const result =
        await getFolders(
          patientId,
          toothNumber
        );

      setFolders(result);

    } catch (error) {
      console.error(error);

      toast.error("Failed to load folders.");

    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFolders();
  }, [patientId, toothNumber]);

 async function handleCreate() {
  if (!folderName.trim()) {
    toast.error("Please enter a folder name.");
    return;
  }

  try {
    setSaving(true);

    await createFolder(
      patientId,
      toothNumber,
      folderName
    );

    setFolderName("");

    setShowCreateModal(false);

    await loadFolders();

  } catch (error) {
    toast.error(
      getSafeErrorMessage(error, "Failed to create folder.", "Failed to create folder:")
    );

  } finally {
    setSaving(false);
  }
}

async function createDefaultFolders() {
  const defaults = [
    "X-Rays",
    "Clinical Photos",
    "Treatment Plan",
    "Consent Forms",
    "Lab Work",
  ];

  try {
    setSaving(true);

    for (const folder of defaults) {
      try {
        await createFolder(
          patientId,
          toothNumber,
          folder
        );
      } catch {
        // Ignore duplicates
      }
    }

    await loadFolders();

  } finally {
    setSaving(false);
  }
}

  async function handleRename() {
    if (
      !activeFolder ||
      !folderName.trim()
    ) {
      return;
    }

    try {
      setSaving(true);

      await renameFolder(
        activeFolder.id,
        folderName
      );

      setShowRenameModal(false);

      setFolderName("");

      setActiveFolder(null);

      await loadFolders();

    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to rename folder.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!activeFolder) {
      return;
    }

    try {
      setSaving(true);

      await deleteFolder(
        activeFolder.id
      );

      setShowDeleteModal(false);

      setActiveFolder(null);

      await loadFolders();

    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to delete folder.")
      );
    } finally {
      setSaving(false);
    }
  }

  const filteredFolders =
  folders.filter((folder) =>
    folder.folder_name
      .toLowerCase()
      .includes(
        search.toLowerCase()
      )
  );

  if (selectedFolder) {
    return (
      <div className="space-y-6">

        <button
          onClick={() =>
            setSelectedFolder(null)
          }
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Back
        </button>

        <div>

          <h2 className="text-2xl font-bold">
            📁{" "}
            {
              selectedFolder.folder_name
            }
          </h2>

          <p className="text-slate-500">
            Manage files in this folder.
          </p>

        </div>

        <FileBrowser
          patientId={patientId}
          toothNumber={toothNumber}
          folderId={selectedFolder.id}
        />

      </div>
    );
  }

  return (
    <>

      <div className="space-y-6">

        <div className="flex items-center justify-between">

          <div>

            <h2 className="text-xl font-semibold">
              Attachments
            </h2>

            <p className="text-sm text-slate-500">
              Organize files into folders.
            </p>

          </div>

          <div className="flex gap-2">

  <Button
    variant="secondary"
    onClick={createDefaultFolders}
  >
    Auto Setup
  </Button>

  <Button
    onClick={() =>
      setShowCreateModal(true)
    }
  >
    + New Folder
  </Button>

</div>

        </div>

        {loading ? (

          <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">

            Loading folders...

          </div>

        ) : (

          <FolderBrowser
  folders={filteredFolders}
            onOpen={setSelectedFolder}
            onRename={(folder) => {
              setActiveFolder(folder);
              setFolderName(
                folder.folder_name
              );
              setShowRenameModal(true);
            }}
            onDelete={(folder) => {
              setActiveFolder(folder);
              setShowDeleteModal(true);
            }}
          />

        )}

      </div>

      {showCreateModal && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-md rounded-2xl bg-white p-6">

            <h2 className="mb-5 text-xl font-semibold">
              New Folder
            </h2>

            <input
              autoFocus
              value={folderName}
              onChange={(e) =>
                setFolderName(
                  e.target.value
                )
              }
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder="Folder name"
            />

            <div className="mt-6 flex justify-end gap-3">

              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateModal(false);
                  setFolderName("");
                }}
              >
                Cancel
              </Button>

              <Button
                disabled={saving}
                onClick={handleCreate}
              >
                Create
              </Button>

            </div>

          </div>

        </div>

      )}

      {showRenameModal && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-md rounded-2xl bg-white p-6">

            <h2 className="mb-5 text-xl font-semibold">
              Rename Folder
            </h2>

            <input
              autoFocus
              value={folderName}
              onChange={(e) =>
                setFolderName(
                  e.target.value
                )
              }
              className="w-full rounded-xl border border-slate-300 px-4 py-3"
            />

            <div className="mt-6 flex justify-end gap-3">

              <Button
                variant="secondary"
                onClick={() =>
                  setShowRenameModal(false)
                }
              >
                Cancel
              </Button>

              <Button
                disabled={saving}
                onClick={handleRename}
              >
                Save
              </Button>

            </div>

          </div>

        </div>

      )}

      {showDeleteModal && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-md rounded-2xl bg-white p-6">

            <h2 className="mb-3 text-xl font-semibold">
              Delete Folder
            </h2>

            <p className="text-slate-600">

              Delete

              <strong>
                {" "}
                {activeFolder?.folder_name}
              </strong>

              ?

            </p>

            <div className="mt-6 flex justify-end gap-3">

              <Button
                variant="secondary"
                onClick={() =>
                  setShowDeleteModal(false)
                }
              >
                Cancel
              </Button>

              <Button
                variant="danger"
                disabled={saving}
                onClick={handleDelete}
              >
                Delete
              </Button>

            </div>

          </div>

        </div>

      )}

    </>
  );
}