"use client";

import { ReactNode } from "react";

import Modal from "./Modal";
import Button from "./Button";

interface Props {
  open: boolean;
  title: string;

  loading?: boolean;

  children: ReactNode;

  onClose: () => void;

  onSubmit: () => void;

  submitText?: string;

  cancelText?: string;
}

export default function FormModal({
  open,
  title,
  loading = false,
  children,
  onClose,
  onSubmit,
  submitText = "Save",
  cancelText = "Cancel",
}: Props) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>

          <Button
            onClick={onSubmit}
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : submitText}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {children}
      </div>
    </Modal>
  );
}