"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Appointment } from "@/types";
import {
  getAppointmentById,
  completeAppointment,
  markAppointmentCompleted,
} from "@/services/appointments";
import { completeAndBillTreatmentItem } from "@/services/treatmentPlans";

import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import CareRail from "@/components/ui/CareRail";
import StatusBadge from "@/components/ui/StatusBadge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { getSafeErrorMessage } from "@/lib/logError";

function AppointmentDetailsPageContent() {
  const params = useParams();
  const router = useRouter();

  const { hasPermission } = usePermissions();

  const appointmentId = String(params.id ?? "");

  const [appointment, setAppointment] =
    useState<Appointment | null>(null);

  const [loading, setLoading] =
    useState(true);
  const [completing, setCompleting] = useState(false);

  // Shown only when the appointment is linked to a treatment that isn't
  // Completed yet AND the current user can attest to clinical work being
  // done ("treatments" permission - a Receptionist has "appointments" but
  // not this, and is never asked the clinical question, matching the
  // existing trg_guard_treatment_plan_item_role database restriction).
  const [confirmTreatmentOpen, setConfirmTreatmentOpen] = useState(false);

  // A second, independent entry point to the exact same Phase C treatment
  // completion path (completeAndBillTreatmentItem) - lets a clinician
  // complete the linked treatment directly from this page instead of
  // routing through the Treatment Plan/Edit flow. Deliberately not tied to
  // "Mark as Completed" or its modal: the appointment and the treatment
  // are separate events, and this button works even when the appointment
  // is already Completed (e.g. the final visit of a multi-visit plan).
  const [directCompleteOpen, setDirectCompleteOpen] = useState(false);
  const [completingTreatmentDirectly, setCompletingTreatmentDirectly] =
    useState(false);

  async function loadAppointment() {
    if (!appointmentId) return;

    try {
      setLoading(true);

      const data = await getAppointmentById(
        appointmentId
      );

      setAppointment(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointment();
  }, [appointmentId]);

  // A treatment counts as askable only if it's linked, not already
  // Completed, and the current user is allowed to attest to clinical work
  // being done - otherwise "Mark as Completed" behaves exactly like
  // before (appointment-only, no financial effect).
  const linkedTreatment = appointment?.treatment_plan_items ?? null;

  const canConfirmTreatment =
    linkedTreatment != null &&
    linkedTreatment.status !== "Completed" &&
    hasPermission("treatments");

  function markAsCompleted() {
    if (!appointment) return;

    if (canConfirmTreatment) {
      setConfirmTreatmentOpen(true);
      return;
    }

    void finishCompletion(false);
  }

  async function finishCompletion(completeTreatment: boolean) {
    if (!appointment) return;

    try {
      setCompleting(true);
      setConfirmTreatmentOpen(false);

      const result = await completeAppointment(appointment.id, {
        completeTreatment,
      });

      setAppointment(result.appointment);

      if (result.invoiced) {
        toast.success(
          "Appointment and treatment completed - invoice created."
        );
      } else if (result.billingDeferred) {
        toast.success(
          "Appointment and treatment completed. A receptionist or admin can invoice it from Billing."
        );
      } else if (result.treatmentCompleted) {
        toast.success("Appointment and treatment completed.");
      } else {
        toast.success("Appointment marked as completed.");
      }
    } catch (error) {
      console.error("Failed to complete appointment:", error);
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to mark appointment as completed."
        )
      );
    } finally {
      setCompleting(false);
    }
  }

  // Calls the exact same Phase C service as the "Mark as Completed" ->
  // "Yes, treatment is complete" path (completeAndBillTreatmentItem), just
  // from a dedicated entry point. All locking, duplicate-charge
  // protection, and billing-deferral behavior is enforced there - this
  // handler only interprets the result for the toast and refreshes the
  // page's data via the same loadAppointment() the initial page load uses.
  async function completeTreatmentDirectly() {
    if (!linkedTreatment) return;

    try {
      setCompletingTreatmentDirectly(true);
      setDirectCompleteOpen(false);

      const result = await completeAndBillTreatmentItem(linkedTreatment.id);

      // Full-app audit fix H5: this direct-completion path used to call
      // completeAndBillTreatmentItem alone, leaving the appointment's own
      // status untouched even when it was still "Scheduled" - the linked
      // treatment finished, and the visit itself was left looking like
      // unfinished upcoming work. A no-op when this appointment already
      // completed earlier (the legitimate multi-visit case).
      if (result.item) {
        await markAppointmentCompleted(appointment!.id);
      }

      if (!result.item) {
        // Lost the race, or double-clicked - complete_treatment_item()
        // is idempotent and returns null when it was already Completed.
        toast.error("Treatment was already completed.");
      } else if (result.invoiced) {
        toast.success("Treatment completed and invoice created.");
      } else if (result.billingDeferred) {
        toast.success("Treatment completed. Billing is pending authorization.");
      } else {
        toast.success("Treatment completed.");
      }

      await loadAppointment();
    } catch (error) {
      console.error("Failed to complete treatment:", error);
      toast.error(
        getSafeErrorMessage(error, "Failed to complete treatment.")
      );
    } finally {
      setCompletingTreatmentDirectly(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading appointment..." />
    );
  }

  if (!appointment) {
    return (
      <div className="flex h-screen items-center justify-center">
        Appointment not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="font-display text-3xl font-bold">
            Appointment Details
          </h1>

          <p className="mt-2 text-sm text-mineral">
            Appointment ID: {appointment.id}
          </p>

        </div>

        <div className="flex flex-wrap gap-3">
          {/* Full-app audit fix C5: was "Scheduled" only - an "Ongoing"
              appointment had no dedicated completion affordance at all,
              so completing one HAD to go through the plain Edit form's
              status dropdown, exactly the bypass this fix closes. Now
              that "Completed" is no longer selectable there, this must
              cover both statuses or an Ongoing appointment could never
              be completed at all. */}
          {(appointment.status === "Scheduled" || appointment.status === "Ongoing") && (
            <Button
              onClick={markAsCompleted}
              disabled={completing}
              aria-label="Mark this appointment as completed"
            >
              {completing
                ? "Marking as completed..."
                : "Mark as Completed"}
            </Button>
          )}

          <Button
            variant="secondary"
            onClick={() => router.back()}
          >
            ← Back
          </Button>
        </div>

      </div>

      <Card className="p-2">
        <CareRail status={appointment.status}>

        <div className="grid gap-8 md:grid-cols-2">

          <div>

            <h2 className="font-display mb-6 text-xl font-bold">
              Patient
            </h2>

            <p className="font-display text-lg font-bold">
              {appointment.patients
                ? `${appointment.patients.first_name} ${appointment.patients.last_name}`
                : "Unknown"}
            </p>

          </div>

          <div>

            <h2 className="font-display mb-6 text-xl font-bold">
              Dentist
            </h2>

            <p className="font-display text-lg font-bold">
              {appointment.dentists?.full_name ??
                "Not Assigned"}
            </p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Date
            </h2>

            <p>{appointment.appointment_date}</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Time
            </h2>

            <p>{appointment.appointment_time}</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Duration
            </h2>

            <p>{appointment.duration ?? 0} minutes</p>

          </div>

          <div>

            <h2 className="mb-2 font-bold">
              Status
            </h2>

            <StatusBadge status={appointment.status} />

          </div>

        </div>
        </CareRail>
      </Card>

      <Card className="p-2">

        <h2 className="font-display text-xl font-bold">
          Treatment
        </h2>

        <p className="mt-4">
          {appointment.treatment}
        </p>

        {linkedTreatment && (
          <p className="mt-2 text-sm text-mineral">
            Linked to plan treatment &quot;{linkedTreatment.procedure}
            &quot; -{" "}
            {linkedTreatment.status === "Completed"
              ? "already marked complete"
              : "not yet complete"}
            . Completing it here creates no bill by itself; only an
            explicit completion confirmation does.
          </p>
        )}

      </Card>

      <Card className="p-2">

        <h2 className="font-display text-xl font-bold">
          Notes
        </h2>

        <p className="mt-4 whitespace-pre-wrap">
          {appointment.notes || "No notes"}
        </p>

      </Card>

      {linkedTreatment &&
        linkedTreatment.status !== "Cancelled" &&
        (linkedTreatment.status === "Completed" ||
          hasPermission("treatments")) && (
          <Card className="p-2">

            <h2 className="font-display text-xl font-bold">
              Treatment Completion
            </h2>

            {linkedTreatment.status === "Completed" ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-eucalyptus/10 px-3 py-2 text-sm font-semibold text-eucalyptus">
                <span aria-hidden="true">✓</span> Treatment Completed
              </div>
            ) : (
              <>
                <p className="mt-4 text-sm text-mineral">
                  Confirm &quot;{linkedTreatment.procedure}&quot; is fully
                  complete to make it eligible for billing. This is
                  independent of the appointment&apos;s own status above.
                </p>

                <Button
                  className="mt-4"
                  onClick={() => setDirectCompleteOpen(true)}
                  disabled={completingTreatmentDirectly}
                >
                  {completingTreatmentDirectly
                    ? "Completing..."
                    : "Treatment Completed"}
                </Button>
              </>
            )}

          </Card>
        )}

      <Modal
        open={directCompleteOpen}
        title="Complete Treatment?"
        onClose={() => setDirectCompleteOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDirectCompleteOpen(false)}
              disabled={completingTreatmentDirectly}
            >
              Cancel
            </Button>

            <Button
              onClick={completeTreatmentDirectly}
              disabled={completingTreatmentDirectly}
            >
              {completingTreatmentDirectly
                ? "Please wait..."
                : "Complete Treatment"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Are you sure this treatment is now fully complete? Completing the
          treatment may make it eligible for billing.
        </p>
      </Modal>

      <Modal
        open={confirmTreatmentOpen}
        title="Is this treatment fully complete?"
        onClose={() => setConfirmTreatmentOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmTreatmentOpen(false)}
              disabled={completing}
            >
              Cancel
            </Button>

            <Button
              variant="secondary"
              onClick={() => finishCompletion(false)}
              disabled={completing}
            >
              Not yet - just complete the appointment
            </Button>

            <Button
              onClick={() => finishCompletion(true)}
              disabled={completing}
            >
              {completing ? "Please wait..." : "Yes, treatment is complete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          &quot;{linkedTreatment?.procedure}&quot; is linked to this
          appointment. This appointment alone never bills the patient - a
          multi-visit treatment (like a root canal across several visits)
          should stay &quot;Not yet&quot; until the work is actually
          finished. Only confirming it&apos;s complete makes it eligible
          for billing.
        </p>
      </Modal>

    </div>
  );
}

export default function AppointmentDetailsPage() {
  return (
    <PermissionGuard permission="appointments">
      <AppointmentDetailsPageContent />
    </PermissionGuard>
  );
}
