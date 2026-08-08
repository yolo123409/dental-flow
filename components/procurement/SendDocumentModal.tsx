"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import { getSupplier } from "@/services/suppliers";
import { normalizeKenyanPhone, buildWhatsAppLink } from "@/lib/whatsapp";
import { logError } from "@/lib/logError";

import { SupplierContact } from "@/types/procurement";

interface Props {
  open: boolean;
  supplierId: string;
  defaultSubject: string;
  defaultMessage: string;
  onClose: () => void;
  onSent: (via: "Email" | "WhatsApp", contactId: string | null) => Promise<void>;
}

type Method = "Email" | "WhatsApp";

/**
 * Shared Send flow for both Purchase Orders and GRNs. No real email/
 * WhatsApp Business API infrastructure exists anywhere in the app (see
 * lib/whatsapp.ts's honest "link opened, not delivered" wording for the
 * appointment-reminder feature) - this deliberately follows the same
 * pattern: a mailto: deep link for Email, a wa.me deep link for
 * WhatsApp, and onSent only ever records "Opened via X", never "Sent"
 * or "Delivered".
 */
export default function SendDocumentModal({
  open,
  supplierId,
  defaultSubject,
  defaultMessage,
  onClose,
  onSent,
}: Props) {
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("Email");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;

    setSubject(defaultSubject);
    setMessage(defaultMessage);
    setLoading(true);

    getSupplier(supplierId)
      .then((supplier) => {
        const active = supplier.clinic_supplier_contacts.filter((c) => c.active);

        setContacts(active);

        const primary = active.find((c) => c.is_primary) ?? active[0] ?? null;

        setContactId(primary?.id ?? null);
        setTo(primary?.email ?? "");
      })
      .catch((error) => {
        logError("[SendDocumentModal] load contacts failed:", error);

        toast.error("Failed to load supplier contacts.");
      })
      .finally(() => setLoading(false));
  }, [open, supplierId, defaultSubject, defaultMessage]);

  const selectedContact = contacts.find((c) => c.id === contactId) ?? null;

  useEffect(() => {
    if (method === "Email") {
      setTo(selectedContact?.email ?? "");
    }
  }, [method, selectedContact]);

  const canUseEmail = Boolean(selectedContact?.email);
  const canUseWhatsApp = Boolean(
    normalizeKenyanPhone(selectedContact?.whatsapp_number ?? selectedContact?.phone)
  );

  async function handleOpen() {
    if (method === "Email" && !to.trim()) {
      toast.error("This contact has no email address.");
      return;
    }

    const normalizedPhone = normalizeKenyanPhone(
      selectedContact?.whatsapp_number ?? selectedContact?.phone
    );

    if (method === "WhatsApp" && !normalizedPhone) {
      toast.error("This contact has no valid WhatsApp/phone number.");
      return;
    }

    try {
      setSending(true);

      await onSent(method, contactId);

      if (method === "Email") {
        window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      } else if (normalizedPhone) {
        window.open(buildWhatsAppLink(normalizedPhone, message), "_blank", "noopener,noreferrer");
      }

      toast.success(`Marked as opened via ${method}.`);

      onClose();
    } catch (error) {
      logError("[SendDocumentModal] send failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to send document."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Send Document"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleOpen}
            disabled={sending || (method === "Email" ? !canUseEmail : !canUseWhatsApp)}
          >
            {sending ? "Please wait..." : `Open in ${method === "Email" ? "Email App" : "WhatsApp"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {loading ? (
          <p className="py-4 text-center text-sm text-mineral">Loading...</p>
        ) : contacts.length === 0 ? (
          <p className="py-4 text-center text-sm text-mineral">
            This supplier has no contacts yet.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-2 block text-sm font-semibold text-graphite">
                Send To
              </label>
              <div className="space-y-1 rounded-lg border border-sea-glass p-2">
                {contacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-porcelain"
                  >
                    <input
                      type="radio"
                      name="send-contact"
                      checked={contactId === contact.id}
                      onChange={() => setContactId(contact.id)}
                      className="h-4 w-4 border-sea-glass text-eucalyptus focus:ring-eucalyptus"
                    />
                    <span>
                      {contact.name}
                      {contact.is_primary ? " — Primary" : ""}
                      {contact.job_title ? ` — ${contact.job_title}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={method === "Email" ? "primary" : "secondary"}
                className="flex-1"
                onClick={() => setMethod("Email")}
                disabled={!canUseEmail}
              >
                Email
              </Button>
              <Button
                type="button"
                variant={method === "WhatsApp" ? "primary" : "secondary"}
                className="flex-1"
                onClick={() => setMethod("WhatsApp")}
                disabled={!canUseWhatsApp}
              >
                WhatsApp
              </Button>
            </div>

            {method === "Email" ? (
              <>
                <FormInput label="To" value={to} onChange={setTo} />
                <FormInput label="Subject" value={subject} onChange={setSubject} />
                <FormTextarea
                  label="Message"
                  rows={8}
                  value={message}
                  onChange={setMessage}
                />
              </>
            ) : (
              <FormTextarea
                label="Message"
                rows={8}
                value={message}
                onChange={setMessage}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
