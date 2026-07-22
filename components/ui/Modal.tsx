"use client";

import { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}

export default function Modal({
  open,
  title,
  children,
  onClose,
  footer,
}: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/35 p-4">

      <div className="w-full max-w-2xl rounded-xl border border-sea-glass bg-enamel shadow-xl">

        <div className="flex items-center justify-between border-b border-sea-glass p-6">

          <h2 className="font-display text-2xl font-bold">
            {title}
          </h2>

          <button
            onClick={onClose}
            className="rounded-md p-1 text-2xl text-mineral transition-colors hover:bg-porcelain hover:text-graphite"
          >
            ×
          </button>

        </div>

        <div className="p-6">
          {children}
        </div>

        {footer && (
          <div className="flex justify-end gap-3 border-t border-sea-glass p-6">
            {footer}
          </div>
        )}

      </div>

    </div>
  );
}
