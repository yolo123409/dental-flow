export interface ApiResponse<T> {
  data: T;
  error: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface SelectOption {
  value: string;
  label: string;
}

export type LoadingState =
  | "idle"
  | "loading"
  | "success"
  | "error";