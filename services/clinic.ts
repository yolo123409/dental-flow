import { getCurrentClinicUser } from "./clinicUsers";

export async function getCurrentClinicId() {
  const user =
    await getCurrentClinicUser();

  if (!user) {
    throw new Error(
      "No authenticated clinic user found."
    );
  }

  if (!user.clinic_id) {
    throw new Error(
      "This user is not linked to a clinic."
    );
  }

  return user.clinic_id;
}