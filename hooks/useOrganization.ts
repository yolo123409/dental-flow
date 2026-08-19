"use client";

import { useOrganizationContext } from "@/contexts/OrganizationContext";

/**
 * Thin re-export of the shared OrganizationContext (provided once in
 * app/admin/layout.tsx around the whole /admin tree) - kept as its own
 * hook so every existing consumer (Sidebar, CeoGuard, the organization
 * pages) is unaffected by the underlying lifted-state change. See
 * contexts/OrganizationContext.tsx for why this is a shared context
 * rather than independent per-component state.
 */
export default function useOrganization() {
  return useOrganizationContext();
}
