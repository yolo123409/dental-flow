/**
 * Canonical payment-method definitions, shared by every payment-method
 * selector in the app (invoice creation's PaymentMethodField, Record
 * Payment) so the option set never drifts between them. BASE_PAYMENT_METHODS
 * is the original set (self-pay methods); PAYMENT_METHODS_WITH_INSURANCE
 * adds Insurance for contexts where it's relevant (invoice creation
 * always; Record Payment only when the invoice itself is an insurance
 * invoice).
 */
export const BASE_PAYMENT_METHODS = [
  "Cash",
  "M-Pesa",
  "Card",
  "Bank Transfer",
] as const;

export const PAYMENT_METHODS_WITH_INSURANCE = [
  ...BASE_PAYMENT_METHODS,
  "Insurance",
] as const;

export type PaymentMethod =
  (typeof PAYMENT_METHODS_WITH_INSURANCE)[number];

/**
 * Money-out payment methods are a deliberately separate list from the
 * incoming ones above - "Insurance" doesn't apply to money leaving the
 * clinic, and outgoing payments add "Cheque" which incoming ones don't
 * offer today.
 */
export const EXPENSE_PAYMENT_METHODS = [
  "Cash",
  "M-Pesa",
  "Bank Transfer",
  "Card",
  "Cheque",
  "Other",
] as const;

export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
