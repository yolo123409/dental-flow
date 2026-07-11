export interface Invoice {
  id: string;

  patient_id: string;

  amount: number;

  paid: number;

  balance: number;

  status: string;

  created_at: string;
}

export interface BillingSummary {
  total: number;
  paid: number;
  outstanding: number;
}