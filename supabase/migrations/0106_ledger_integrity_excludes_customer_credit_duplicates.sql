-- FIN-4.8: fixes a real false-positive in get_ledger_integrity_summary()
-- (migration 0087), found by this phase's concurrency testing of the
-- FIN-4.7 Customer Credit UI (applying one credit to more than one
-- invoice - an ordinary, correct, everyday action, not a race or a bug).
--
-- THE GAP: migration 0087's "duplicate (reference_type, reference_id)"
-- check was written to catch what should be structurally impossible for
-- invoice/payment/expense/etc. postings - reference types that
-- idx_clinic_ledger_transactions_reference_unique (migration 0044)
-- already enforces true uniqueness for. Migration 0087's own header
-- comment names that exact list. But 'customer_credit' (introduced later
-- by migration 0100) was DELIBERATELY left out of that unique index -
-- see migration 0100's own note - because a single Customer Credit is
-- meant to be applied across MULTIPLE invoices over its lifetime (grant,
-- one or more partial applies, an eventual refund), each posting its own
-- ledger transaction sharing reference_id = the credit's own id. This
-- function's duplicate check never accounted for that: it flags EVERY
-- reference_type without distinction, so the moment any clinic applies
-- one credit to a second invoice - completely normal use of the FIN-4.7
-- UI - this function reports a "duplicate reference group".
--
-- WHY THIS MATTERS: services/accountingHealth.ts wires
-- duplicate_reference_groups directly into the Financial Health Center's
-- ledger-integrity check, and ANY nonzero value there marks that check
-- "critical" - the Center's own most severe status. Left unfixed, this
-- phase's own FIN-4.7 feature would make the Financial Health Center
-- report a false critical alarm for entirely correct books the first
-- time any clinic used it normally.
--
-- THE FIX: restrict the duplicate check to exactly the reference types
-- idx_clinic_ledger_transactions_reference_unique already enforces real
-- uniqueness for (the same list migration 0087's own comment names) -
-- for those, more than one posting per reference is still exactly as
-- suspicious as before, unchanged. 'customer_credit' (and any future
-- reference_type this schema deliberately allows to repeat) is simply
-- outside what this audit checks, matching the database's own actual
-- uniqueness design instead of a blanket assumption that predates it.
-- Every other column/behavior of this function is unchanged from
-- migration 0087.

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
      and reference_type in (
        'invoice', 'payment', 'expense', 'expense_void', 'grn',
        'inventory_movement', 'supplier_payment', 'supplier_payment_void'
      )
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

-- Signature unchanged - create or replace, no grant/drop needed.
