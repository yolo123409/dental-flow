"use client";

import { useEffect, useRef, useState } from "react";

import {
  ToothFile,
  isImage,
  isPdf,
} from "@/services/patientToothFiles";

interface Props {
  file: ToothFile;

  viewMode: "grid" | "list";

  onOpen: (file: ToothFile) => void;

  onDownload: (file: ToothFile) => void;

  onRename: (file: ToothFile) => void;

  onDelete: (file: ToothFile) => void;

  formatSize: (
    bytes: number | null
  ) => string;
}

export default function FileCard({
  file,
  viewMode,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  formatSize,
}: Props) {
  const [menuOpen, setMenuOpen] =
    useState(false);

  const [menuLeft, setMenuLeft] =
    useState(false);

  const menuRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent
    ) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node
        )
      ) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener(
        "mousedown",
        handleClickOutside
      );

      const rect =
        menuRef.current?.getBoundingClientRect();

      if (rect) {
        const menuWidth = 224;
        const spaceRight =
          window.innerWidth - rect.right;

        setMenuLeft(
          spaceRight < menuWidth + 24
        );
      }
    }

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
    };
  }, [menuOpen]);

  const menuContent = (
    <div
      className={`absolute top-2 z-[100] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ${
        menuLeft
          ? "right-full mr-3"
          : "left-full ml-3"
      }`}
    >
      <button
        onClick={() => {
          setMenuOpen(false);
          onOpen(file);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-slate-100"
      >
        👁
        <span>Open</span>
      </button>

      <button
        onClick={() => {
          setMenuOpen(false);
          onDownload(file);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-slate-100"
      >
        ⬇
        <span>Download</span>
      </button>

      <button
        onClick={() => {
          setMenuOpen(false);
          onRename(file);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-slate-100"
      >
        ✏️
        <span>Rename</span>
      </button>

      <div className="border-t border-slate-100" />

      <button
        onClick={() => {
          setMenuOpen(false);
          onDelete(file);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-600 transition hover:bg-red-50"
      >
        🗑
        <span>Delete</span>
      </button>
    </div>
  );

  if (viewMode === "list") {
    return (
      <div
        ref={menuRef}
        className="relative overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
      >
        <div
          onClick={() =>
            onOpen(file)
          }
          className="flex cursor-pointer items-center gap-5 p-4"
        >
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {isImage(file) &&
            file.thumbnailUrl ? (
              <img
                src={file.thumbnailUrl}
                alt={file.file_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl">
                {isPdf(file)
                  ? "📕"
                  : "📄"}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="truncate font-semibold">
              {file.file_name}
            </h4>

            <p className="mt-1 text-sm text-slate-500">
              {file.mime_type ??
                "Unknown"}
            </p>

            <p className="mt-2 text-xs text-slate-400">
              {formatSize(
                file.file_size
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(
                !menuOpen
              );
            }}
            className="flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-slate-100"
          >
            ⋮
          </button>
        </div>

        {menuOpen && menuContent}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="relative overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg"
    >
      <div
        onClick={() =>
          onOpen(file)
        }
        className="cursor-pointer"
      >
        {isImage(file) &&
        file.thumbnailUrl ? (
          <img
            src={file.thumbnailUrl}
            alt={file.file_name}
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-slate-100 text-7xl">
            {isPdf(file)
              ? "📕"
              : "📄"}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-semibold">
            {file.file_name}
          </h4>

          <p className="mt-1 text-xs text-slate-500">
            {formatSize(
              file.file_size
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(
              !menuOpen
            );
          }}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition hover:bg-slate-100"
        >
          ⋮
        </button>
      </div>

      {menuOpen && menuContent}
    </div>
  );
}