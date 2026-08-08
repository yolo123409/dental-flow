"use client";

import { ReactNode, useEffect } from "react";

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
  // Lock background scroll while any modal is open - restores whatever
  // the previous inline value was (usually none) rather than assuming
  // "unset", so this behaves correctly even if something else already
  // had an opinion on body overflow.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/35 p-4">

      {/*
        flex-col + max-h caps the card at the viewport regardless of how
        tall its content is; min-h-0 on the scrolling body is required for
        a flex child to actually shrink below its content's natural height
        instead of just pushing the footer off-screen - overflow-y-auto
        alone does nothing without it. Header/footer are shrink-0 so
        only the middle section ever scrolls.
      */}
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-sea-glass bg-enamel shadow-xl">

        <div className="flex shrink-0 items-center justify-between border-b border-sea-glass p-6">

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

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-sea-glass p-6">
            {footer}
          </div>
        )}

      </div>

    </div>
  );
}
