-- Critical Safety Closure (Audit II, Critical #3, Tier 1): suspending a
-- staff member (services/users.ts#suspendUser, clinic_users.status =
-- 'Suspended') never actually revoked their access - clinic_users.status
-- was checked NOWHERE in this app's real enforcement boundary (this app
-- has no server-side session store or cookie-based SSR auth at all;
-- every request is the browser's own JWT hitting PostgREST directly, so
-- Postgres RLS is the only real boundary - see services/authorization.ts
-- own header comment). A suspended person's already-issued JWT kept
-- working for as long as they didn't explicitly sign out.
--
-- THIS MIGRATION is Tier 1 of the fix: the three shared choke points
-- that together close the large majority of the exposure surface in one
-- place each, rather than touching ~180+ individual RLS policies:
--
--   1. clinic_users_select_self (0002) is the RLS policy every OTHER
--      table's policy structurally depends on - virtually every policy
--      in this schema resolves clinic membership via a raw, non-
--      security-definer `exists (select 1 from clinic_users cu where
--      cu.auth_user_id = auth.uid() ...)` subquery, and that subquery is
--      itself subject to clinic_users' own RLS (plain SQL subqueries are
--      NOT security-definer, so they don't bypass RLS on the table they
--      query). Adding `and status = 'Active'` here makes a suspended
--      user's own membership row invisible to EVERY one of those
--      subqueries simultaneously, for both reads and writes, across
--      every table that follows this pattern.
--   2. _caller_role() (0097) - security definer, so it does NOT inherit
--      fix #1 above - is the single function every _trigger_guard_role-
--      family write-guard trigger calls (clinic_invoices, clinic_
--      invoice_items, clinic_payments, clinic_expenses, clinic_
--      inventory_items, clinic_inventory_movements, clinic_goods_
--      received_notes, clinic_grn_items, clinic_purchase_orders, clinic_
--      purchase_order_items, customer_credits). Patching it here closes
--      every one of those tables' write guards in one place.
--   3. is_clinic_owner_or_admin() (0008) - same reasoning, security
--      definer - is the function every staff-management/settings/
--      branch-admin RLS policy calls. A suspended Owner/Admin can no
--      longer suspend/reactivate/delete/edit-role another staff member,
--      change clinic settings, or manage branches once this is patched.
--
-- The admin-facing policy clinic_users_select_own_clinic_staff_admins
-- (0008) is deliberately UNTOUCHED - it goes through is_clinic_owner_
-- or_admin (fix #3), so an ACTIVE Owner/Admin can still see and
-- reactivate a suspended colleague's row, while a SUSPENDED Owner/Admin
-- is correctly rejected by that same patched function.
--
-- Tier 2 (a follow-up migration) covers ~20 additional security definer
-- RPCs that each independently resolve the caller's clinic_users row
-- rather than going through these two functions - void_invoice,
-- void_payment, grant_customer_credit, apply_customer_credit,
-- reverse_ledger_transaction, adjust_inventory_stock, and more. This
-- migration alone does NOT close those.
--
-- Explicitly out of scope: is_organization_ceo() has the same shape of
-- gap against organization_users.role, but organization_users has no
-- status/suspended concept in this schema at all - extending suspension
-- semantics to the organization layer is a different, larger feature,
-- not a mechanical extension of this fix.
--
-- Safe to re-run: drop policy if exists + create; create or replace
-- function, same signatures.

drop policy if exists "clinic_users_select_self" on public.clinic_users;
create policy "clinic_users_select_self"
  on public.clinic_users for select
  using (auth_user_id = auth.uid() and status = 'Active');

create or replace function public._caller_role(p_clinic_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select cu.role from public.clinic_users cu
  where cu.auth_user_id = auth.uid()
    and cu.clinic_id = p_clinic_id
    and cu.status = 'Active'
  limit 1;
$$;

create or replace function public.is_clinic_owner_or_admin(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.clinic_users cu
    where cu.auth_user_id = auth.uid()
      and cu.clinic_id = p_clinic_id
      and cu.status = 'Active'
      and cu.role in ('Owner', 'Admin')
  );
end;
$$;
