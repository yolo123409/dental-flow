-- Full-app audit fix C4 (Critical), server-side half: _trigger_post_
-- invoice_ledger / _trigger_post_payment_ledger derive the ledger
-- transaction's transaction_date via a bare `::date` cast on a
-- timestamptz column (NEW.created_at / NEW.received_at). A bare cast
-- uses the DATABASE SESSION's timezone (UTC on Supabase), not the
-- clinic's own configured timezone - so an invoice or payment created
-- between local midnight and ~3am (for Africa/Nairobi, UTC+3, this app's
-- own documented default - clinic_settings.timezone, migration 0001)
-- gets journaled under the WRONG, previous calendar day.
--
-- clinic_settings.timezone has existed since day one but was never read
-- by any function anywhere in this codebase (confirmed by search) - both
-- triggers already join clinic_settings for `cs.currency`; this migration
-- extends that exact same select to also fetch `cs.timezone` and uses
-- `at time zone` to convert the timestamptz to the clinic's own local
-- wall-clock time before extracting the calendar date, instead of
-- `::date`, which implicitly does the same conversion but against the
-- session's timezone rather than the clinic's.
--
-- Safe to re-run: create or replace, identical trigger signatures.

create or replace function public._trigger_post_invoice_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_timezone text;
  v_tax numeric;
  v_revenue_amount numeric;
  v_entries jsonb;
begin
  if NEW.total is null or NEW.total <= 0 then
    return NEW;
  end if;

  begin
    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    if v_settings.accounts_receivable_account_id is null or v_settings.treatment_revenue_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (NEW.clinic_id, 'invoice', NEW.id, 'Accounts Receivable or Treatment Revenue account is not configured.');
      return NEW;
    end if;

    select cs.currency, cs.timezone into v_currency, v_timezone from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    v_tax := coalesce(NEW.tax, 0);

    if v_tax > 0 and v_settings.vat_payable_account_id is not null then
      v_revenue_amount := NEW.total - v_tax;

      v_entries := jsonb_build_array(
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', NEW.total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.treatment_revenue_account_id, 'debit', 0, 'credit', v_revenue_amount),
        jsonb_build_object('account_id', v_settings.vat_payable_account_id, 'debit', 0, 'credit', v_tax)
      );
    else
      if v_tax > 0 then
        insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
        values (NEW.clinic_id, 'invoice', NEW.id, 'VAT Payable account is not configured; tax amount was posted to Treatment Revenue instead.');
      end if;

      v_entries := jsonb_build_array(
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', NEW.total, 'credit', 0),
        jsonb_build_object('account_id', v_settings.treatment_revenue_account_id, 'debit', 0, 'credit', NEW.total)
      );
    end if;

    perform public._post_ledger_transaction(
      NEW.clinic_id, (NEW.created_at at time zone coalesce(v_timezone, 'Africa/Nairobi'))::date, 'Invoice', 'invoice', NEW.id,
      'Invoice ' || NEW.invoice_number, coalesce(v_currency, 'KES'),
      v_entries,
      NEW.patient_id, null, null, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'invoice', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;

create or replace function public._trigger_post_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.clinic_ledger_settings;
  v_currency text;
  v_timezone text;
  v_cash_account_id uuid;
begin
  if NEW.amount is null or NEW.amount <= 0 then
    return NEW;
  end if;

  begin
    perform public._ensure_ledger_provisioned_for_clinic(NEW.clinic_id);

    select * into v_settings from public.clinic_ledger_settings s where s.clinic_id = NEW.clinic_id;

    v_cash_account_id := coalesce(
      (v_settings.payment_method_accounts ->> NEW.payment_method)::uuid,
      v_settings.default_cash_account_id
    );

    if v_cash_account_id is null or v_settings.accounts_receivable_account_id is null then
      insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
      values (
        NEW.clinic_id, 'payment', NEW.id,
        'No account configured for payment method "' || NEW.payment_method || '" or Accounts Receivable.'
      );
      return NEW;
    end if;

    select cs.currency, cs.timezone into v_currency, v_timezone from public.clinic_settings cs where cs.clinic_id = NEW.clinic_id;

    perform public._post_ledger_transaction(
      NEW.clinic_id, (NEW.received_at at time zone coalesce(v_timezone, 'Africa/Nairobi'))::date, 'Payment', 'payment', NEW.id,
      'Payment received via ' || NEW.payment_method, coalesce(v_currency, 'KES'),
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash_account_id, 'debit', NEW.amount, 'credit', 0),
        jsonb_build_object('account_id', v_settings.accounts_receivable_account_id, 'debit', 0, 'credit', NEW.amount)
      ),
      NEW.patient_id, null, null, null
    );
  exception when others then
    insert into public.clinic_ledger_reconciliation_issues (clinic_id, reference_type, reference_id, issue)
    values (NEW.clinic_id, 'payment', NEW.id, 'Ledger posting failed: ' || sqlerrm);
  end;

  return NEW;
end;
$$;
