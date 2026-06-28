"use client";

import Modal from "./Modal";
import Button from "./Button";

interface ConfirmDialogProps {
  open: boolean;

  title: string;

  description?: string;

  confirmText?: string;

  cancelText?: string;

  loading?: boolean;

  onCancel: () => void;

  onConfirm: () => void | Promise<void>;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </Button>

          <Button
            onClick={onConfirm}
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-2 py-2">

        {description && (
          <p className="text-sm text-slate-600">
            {description}
          </p>
        )}

      </div>
    </Modal>
  );
}