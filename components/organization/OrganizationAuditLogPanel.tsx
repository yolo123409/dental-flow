"use client";

import { useCallback, useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { getOrganizationAuditLog } from "@/services/organizationAuditLog";
import { logError } from "@/lib/logError";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import {
  OrganizationAuditLogEntry,
  AUDIT_ACTION_LABELS,
} from "@/types/organizationAuditLog";

interface Props {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 25;

export default function OrganizationAuditLogPanel({
  organizationId,
  open,
  onClose,
}: Props) {
  const [entries, setEntries] = useState<OrganizationAuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { entries: rows, totalCount: count } =
        await getOrganizationAuditLog(organizationId, {
          limit: PAGE_SIZE,
          offset,
        });

      setEntries(rows);
      setTotalCount(count);
    } catch (error) {
      logError("[OrganizationAuditLogPanel] Failed to load audit log:", error);
    } finally {
      setLoading(false);
    }
  }, [organizationId, offset]);

  useEffect(() => {
    if (!open) return;

    setOffset(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    load();
  }, [open, load]);

  if (!open) return null;

  const hasNext = offset + PAGE_SIZE < totalCount;
  const hasPrev = offset > 0;

  return (
    <Modal open={open} title="Audit Log" onClose={onClose}>
      {loading ? (
        <p className="py-8 text-center text-sm text-mineral">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-mineral">
          No activity recorded yet.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-sea-glass px-3 py-2.5 text-sm"
            >
              <p className="text-graphite">
                <span className="font-medium">{entry.actor_full_name}</span>{" "}
                {AUDIT_ACTION_LABELS[entry.action]}{" "}
                {entry.target_full_name || entry.target_email ? (
                  <span className="font-medium">
                    {entry.target_full_name ?? entry.target_email}
                  </span>
                ) : null}
                {entry.target_clinic_name && (
                  <span className="text-mineral">
                    {" "}
                    at {entry.target_clinic_name}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-mineral">
                {formatRelativeTime(entry.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!hasPrev || loading}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          >
            Previous
          </Button>

          <span className="text-xs text-mineral">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of{" "}
            {totalCount}
          </span>

          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={!hasNext || loading}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      )}
    </Modal>
  );
}
