-- Phase Q1/Q9: a read-only ledger integrity audit - every transaction in
-- clinic_ledger_transactions should satisfy SUM(debits) = SUM(credits)
-- (the invariant public._post_ledger_transaction, migration 0043,
-- already enforces at insert time) and should have at least one entry.
-- This function re-verifies that invariant independently after the fact,
-- as a belt-and-suspenders audit - it does not invent any new accounting
-- rule beyond what the existing posting helper already guarantees.
--
-- Also counts duplicate (reference_type, reference_id) groups: mostly
-- already prevented by idx_clinic_ledger_transactions_reference_unique
-- (migration 0044) for the reference_types it covers ('invoice',
-- 'payment', 'expense', 'expense_void', 'grn', 'inventory_movement',
-- 'supplier_payment', 'supplier_payment_void'), but that index has no
-- opinion on any other reference_type - so this still has real value as
-- an audit rather than being fully redundant with an existing constraint.
--
-- "Invalid/orphaned account references" (Q9) are NOT separately checked
-- here: clinic_ledger_entries.account_id is `not null references
-- clinic_ledger_accounts(id) on delete restrict` (migration 0043), so an
-- entry referencing a nonexistent account is already structurally
-- impossible at the database level - there is nothing for a read-only
-- audit to usefully re-check beyond what that foreign key already
-- guarantees.
--
-- `security invoker` (not definer) - RLS on clinic_ledger_transactions/
-- entries still independently governs what the calling user can see.
-- Never writes anything.
create or replace function public.get_ledger_integrity_summary(p_clinic_id uuid)
returns table (
  total_transactions bigint,
  transactions_without_entries bigint,
  unbalanced_transactions bigint,
  unbalanced_amount numeric,
  duplicate_reference_groups bigint,
  duplicate_reference_transactions bigint
)
language sql
security invoker
set search_path = public
stable
as $$
  with txn_entries as (
    select
      t.id as transaction_id,
      coalesce(sum(e.debit), 0) as total_debit,
      coalesce(sum(e.credit), 0) as total_credit,
      count(e.id) as entry_count
    from public.clinic_ledger_transactions t
    left join public.clinic_ledger_entries e on e.transaction_id = t.id
    where t.clinic_id = p_clinic_id
    group by t.id
  ),
  duplicate_groups as (
    select reference_type, reference_id, count(*) as cnt
    from public.clinic_ledger_transactions
    where clinic_id = p_clinic_id
      and reference_type is not null
      and reference_id is not null
    group by reference_type, reference_id
    having count(*) > 1
  )
  select
    (select count(*) from txn_entries) as total_transactions,
    (select count(*) from txn_entries where entry_count = 0) as transactions_without_entries,
    (select count(*) from txn_entries where entry_count > 0 and abs(total_debit - total_credit) > 0.01)
      as unbalanced_transactions,
    (select coalesce(sum(abs(total_debit - total_credit)), 0) from txn_entries
      where entry_count > 0 and abs(total_debit - total_credit) > 0.01) as unbalanced_amount,
    (select count(*) from duplicate_groups) as duplicate_reference_groups,
    (select coalesce(sum(cnt), 0) from duplicate_groups) as duplicate_reference_transactions;
$$;

grant execute on function public.get_ledger_integrity_summary(uuid) to authenticated;
