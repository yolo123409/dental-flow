"use client";

import { Trash2, ChevronUp, ChevronDown } from "lucide-react";

import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { CustomFieldDefinition } from "@/types/procurement";

interface Props {
  fields: CustomFieldDefinition[];
  onChange: (fields: CustomFieldDefinition[]) => void;
}

const TYPES: CustomFieldDefinition["type"][] = ["text", "number", "date"];

function slugify(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `field_${Date.now()}`
  );
}

/**
 * Simple label/type/required/order list editor - deliberately not a
 * generic form-builder, matching the spec's "keep it simple" instruction
 * for PO/GRN custom fields (Department, Requested By, Delivery Driver,
 * Vehicle Registration, etc.).
 */
export default function CustomFieldsEditor({ fields, onChange }: Props) {
  function addField() {
    onChange([
      ...fields,
      {
        key: `field_${Date.now()}`,
        label: "",
        type: "text",
        required: false,
        display_order: fields.length,
      },
    ]);
  }

  function updateField(index: number, patch: Partial<CustomFieldDefinition>) {
    const next = fields.map((field, i) =>
      i === index ? { ...field, ...patch } : field
    );
    onChange(next);
  }

  function removeField(index: number) {
    onChange(
      fields
        .filter((_, i) => i !== index)
        .map((field, i) => ({ ...field, display_order: i }))
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;

    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];

    onChange(next.map((field, i) => ({ ...field, display_order: i })));
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <p className="text-sm text-mineral">No custom fields yet.</p>
      ) : (
        fields.map((field, index) => (
          <div
            key={field.key}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-sea-glass p-3"
          >
            <div className="min-w-[10rem] flex-1">
              <FormInput
                label="Label"
                value={field.label}
                onChange={(value) =>
                  updateField(index, {
                    label: value,
                    key: field.key.startsWith("field_")
                      ? slugify(value)
                      : field.key,
                  })
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-graphite">
                Type
              </label>
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(index, {
                    type: e.target.value as CustomFieldDefinition["type"],
                  })
                }
                className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 pb-2.5 text-sm text-graphite">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) =>
                  updateField(index, { required: e.target.checked })
                }
                className="h-4 w-4 rounded border-sea-glass text-eucalyptus focus:ring-eucalyptus"
              />
              Required
            </label>

            <div className="flex gap-1 pb-1.5">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="rounded-lg p-2 text-slate-500 hover:bg-porcelain disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
                className="rounded-lg p-2 text-slate-500 hover:bg-porcelain disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                onClick={() => removeField(index)}
                className="rounded-lg p-2 text-clay hover:bg-porcelain"
                aria-label="Remove field"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))
      )}

      <Button type="button" variant="secondary" onClick={addField}>
        + Add Custom Field
      </Button>
    </div>
  );
}
