"use client";

import { useEffect, useState } from "react";

import { Dentist } from "@/types/dentist";

import {
  getDentists,
  deleteDentist,
} from "@/services/dentists";

import DentistHeader from "@/components/dentists/DentistHeader";
import DentistStats from "@/components/dentists/DentistStats";
import DentistGrid from "@/components/dentists/DentistGrid";
import AddDentistModal from "@/components/dentists/AddDentistModal";
import EditDentistModal from "@/components/dentists/EditDentistModal";

import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function DentistsPage() {
  const [dentists, setDentists] = useState<Dentist[]>([]);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [showAddModal, setShowAddModal] =
    useState(false);

  const [showEditModal, setShowEditModal] =
    useState(false);

  const [showDeleteDialog, setShowDeleteDialog] =
    useState(false);

  const [selectedDentist, setSelectedDentist] =
    useState<Dentist | null>(null);

  useEffect(() => {
    loadDentists();
  }, []);

  async function loadDentists() {
    try {
      setLoading(true);

      const data = await getDentists();

      setDentists(data);

    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(dentist: Dentist) {
    setSelectedDentist(dentist);
    setShowEditModal(true);
  }

  function handleDelete(dentist: Dentist) {
    setSelectedDentist(dentist);
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!selectedDentist) return;

    try {
      setDeleting(true);

      await deleteDentist(selectedDentist.id);

      await loadDentists();

      setShowDeleteDialog(false);
      setSelectedDentist(null);

    } catch (error) {
      console.error(error);
      alert("Failed to delete dentist.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <LoadingSpinner text="Loading dentists..." />
    );
  }

  const active = dentists.filter(
    (d) => d.active
  ).length;

  const inactive = dentists.length - active;

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">

        <DentistHeader
          total={dentists.length}
        />

        <Button
          onClick={() =>
            setShowAddModal(true)
          }
        >
          + Add Dentist
        </Button>

      </div>

      <DentistStats
        total={dentists.length}
        active={active}
        inactive={inactive}
      />

      {dentists.length === 0 ? (
        <EmptyState
          title="No Dentists"
          description="Add your first dentist to get started."
          action={
            <Button
              onClick={() =>
                setShowAddModal(true)
              }
            >
              Add Dentist
            </Button>
          }
        />
      ) : (
        <DentistGrid
          dentists={dentists}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      <AddDentistModal
        open={showAddModal}
        onClose={() =>
          setShowAddModal(false)
        }
        onSuccess={loadDentists}
      />

      <EditDentistModal
        open={showEditModal}
        dentist={selectedDentist}
        onClose={() => {
          setShowEditModal(false);
          setSelectedDentist(null);
        }}
        onSuccess={loadDentists}
      />

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Dentist"
        description={
          selectedDentist
            ? `Are you sure you want to delete ${selectedDentist.full_name}? This action cannot be undone.`
            : ""
        }
        confirmText={
          deleting ? "Deleting..." : "Delete"
        }
        loading={deleting}
        onCancel={() => {
          setShowDeleteDialog(false);
          setSelectedDentist(null);
        }}
        onConfirm={confirmDelete}
      />

    </div>
  );
}