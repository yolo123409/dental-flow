"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import CustomFieldsEditor from "@/components/procurement/CustomFieldsEditor";

import {
  getProcurementSettings,
  updateProcurementSettings,
} from "@/services/procurementSettings";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { ProcurementSettings, CustomFieldDefinition } from "@/types/procurement";

function ProcurementSettingsContent() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ProcurementSettings | null>(null);
  const [savingPo, setSavingPo] = useState(false);
  const [savingGrn, setSavingGrn] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);

      const data = await getProcurementSettings();

      setSettings(data);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load settings.", "[ProcurementSettings] load failed:")
      );
    } finally {
      setLoading(false);
    }
  }

  function patch(fields: Partial<ProcurementSettings>) {
    setSettings((prev) => (prev ? { ...prev, ...fields } : prev));
  }

  async function savePoSettings() {
    if (!settings) return;

    try {
      setSavingPo(true);

      await updateProcurementSettings({
        po_prefix: settings.po_prefix,
        po_document_title: settings.po_document_title,
        po_header_text: settings.po_header_text,
        po_footer_text: settings.po_footer_text,
        po_default_notes: settings.po_default_notes,
        po_terms: settings.po_terms,
        po_signature_label: settings.po_signature_label,
        po_custom_fields: settings.po_custom_fields,
      });

      toast.success("Purchase Order template saved.");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to save settings.",
          "[ProcurementSettings] save PO settings failed:"
        )
      );
    } finally {
      setSavingPo(false);
    }
  }

  async function saveGrnSettings() {
    if (!settings) return;

    try {
      setSavingGrn(true);

      await updateProcurementSettings({
        grn_prefix: settings.grn_prefix,
        grn_document_title: settings.grn_document_title,
        grn_header_text: settings.grn_header_text,
        grn_footer_text: settings.grn_footer_text,
        grn_signature_label: settings.grn_signature_label,
        grn_visible_columns: settings.grn_visible_columns,
        grn_custom_fields: settings.grn_custom_fields,
      });

      toast.success("GRN template saved.");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to save settings.",
          "[ProcurementSettings] save GRN settings failed:"
        )
      );
    } finally {
      setSavingGrn(false);
    }
  }

  if (loading || !settings) {
    return <LoadingSpinner text="Loading procurement settings..." />;
  }

  const columnLabels: Record<keyof ProcurementSettings["grn_visible_columns"], string> = {
    ordered: "Ordered Quantity",
    received: "Received Quantity",
    unit: "Unit",
    unit_cost: "Unit Cost",
    batch: "Batch/Lot",
    expiry: "Expiry",
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Procurement Settings</h1>
        <p className="mt-2 text-slate-500">
          Customize how your Purchase Order and GRN documents look.
        </p>
      </div>

      <Card title="Purchase Order Template">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="PO Prefix"
              value={settings.po_prefix}
              onChange={(v) => patch({ po_prefix: v })}
            />
            <FormInput
              label="Document Title"
              value={settings.po_document_title}
              onChange={(v) => patch({ po_document_title: v })}
            />
          </div>

          <FormTextarea
            label="Header Text (optional)"
            value={settings.po_header_text ?? ""}
            onChange={(v) => patch({ po_header_text: v || null })}
          />
          <FormTextarea
            label="Footer Text (optional)"
            value={settings.po_footer_text ?? ""}
            onChange={(v) => patch({ po_footer_text: v || null })}
          />
          <FormTextarea
            label="Default Notes (optional)"
            value={settings.po_default_notes ?? ""}
            onChange={(v) => patch({ po_default_notes: v || null })}
          />
          <FormTextarea
            label="Terms (optional)"
            value={settings.po_terms ?? ""}
            onChange={(v) => patch({ po_terms: v || null })}
          />
          <FormInput
            label="Signature Label"
            value={settings.po_signature_label}
            onChange={(v) => patch({ po_signature_label: v })}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Custom Fields
            </label>
            <CustomFieldsEditor
              fields={settings.po_custom_fields}
              onChange={(fields: CustomFieldDefinition[]) =>
                patch({ po_custom_fields: fields })
              }
            />
          </div>

          <Button disabled={savingPo} onClick={savePoSettings}>
            {savingPo ? "Saving..." : "Save Purchase Order Template"}
          </Button>
        </div>
      </Card>

      <Card title="GRN Template">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="GRN Prefix"
              value={settings.grn_prefix}
              onChange={(v) => patch({ grn_prefix: v })}
            />
            <FormInput
              label="Document Title"
              value={settings.grn_document_title}
              onChange={(v) => patch({ grn_document_title: v })}
            />
          </div>

          <FormTextarea
            label="Header Text (optional)"
            value={settings.grn_header_text ?? ""}
            onChange={(v) => patch({ grn_header_text: v || null })}
          />
          <FormTextarea
            label="Footer Text (optional)"
            value={settings.grn_footer_text ?? ""}
            onChange={(v) => patch({ grn_footer_text: v || null })}
          />
          <FormInput
            label="Signature Label"
            value={settings.grn_signature_label}
            onChange={(v) => patch({ grn_signature_label: v })}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Visible Columns
            </label>
            <div className="flex flex-wrap gap-4">
              {(
                Object.keys(columnLabels) as Array<
                  keyof ProcurementSettings["grn_visible_columns"]
                >
              ).map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-2 text-sm text-graphite"
                >
                  <input
                    type="checkbox"
                    checked={settings.grn_visible_columns[col]}
                    onChange={(e) =>
                      patch({
                        grn_visible_columns: {
                          ...settings.grn_visible_columns,
                          [col]: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
                  />
                  {columnLabels[col]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Custom Fields
            </label>
            <CustomFieldsEditor
              fields={settings.grn_custom_fields}
              onChange={(fields: CustomFieldDefinition[]) =>
                patch({ grn_custom_fields: fields })
              }
            />
          </div>

          <Button disabled={savingGrn} onClick={saveGrnSettings}>
            {savingGrn ? "Saving..." : "Save GRN Template"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function ProcurementSettingsPage() {
  return (
    <PermissionGuard permission="settings">
      <ProcurementSettingsContent />
    </PermissionGuard>
  );
}
