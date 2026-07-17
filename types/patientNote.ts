export interface PatientNoteAuthor {
  id: string;

  full_name: string;

  role: string | null;
}

export interface PatientNote {
  id: string;

  clinic_id: string;

  patient_id: string;

  author_id: string | null;

  title: string;

  content: string;

  is_pinned: boolean;

  created_at: string;

  updated_at: string;

  clinic_users?: PatientNoteAuthor | null;
}

export interface CreatePatientNoteData {
  patient_id: string;

  title: string;

  content: string;

  is_pinned?: boolean;
}

export interface UpdatePatientNoteData {
  title?: string;

  content?: string;

  is_pinned?: boolean;
}