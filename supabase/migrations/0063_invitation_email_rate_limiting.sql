-- Rate limiting for POST /api/invitations/send-email, found missing
-- during a production-hardening audit: the route is intentionally
-- unauthenticated (token-gated, like the /invite/[token] page itself -
-- see its own doc comment), but had no limit on how many times a given
-- token could trigger a real outbound email. Since the token also
-- identifies a real person's email address (the invitation's own
-- recipient), an unthrottled endpoint is a repeated-send/harassment and
-- Resend-quota-exhaustion vector against that specific person.
--
-- The app deploys to Vercel (serverless, many stateless instances), so
-- an in-memory counter inside the route would not be shared across
-- invocations and would not actually limit anything. This uses Postgres
-- (already the app's only backing store - no new external dependency)
-- as the shared counter instead, via a single SECURITY DEFINER function
-- that atomically checks-and-records one attempt per call.
--
-- Deliberately stores only the token and a timestamp - no IP address,
-- no email, no other identifying data - satisfying "do not store
-- unnecessary personal information" while still being an effective
-- per-invitation throttle (the token already uniquely scopes the limit
-- to one invitation/recipient).
--
-- The table has RLS enabled with zero policies (no direct anon/
-- authenticated access whatsoever, by design - not even SELECT), so the
-- SECURITY DEFINER function below is the only way to reach it, matching
-- the existing "immutable log, RPC-mediated" pattern already used for
-- clinic_ledger_transactions/clinic_inventory_movements in this schema.
-- The function self-prunes rows older than an hour on every call, so no
-- separate cleanup job/cron is needed and the table cannot grow
-- unbounded.

create table if not exists public.invitation_email_rate_limits (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invitation_email_rate_limits_token_created_at
  on public.invitation_email_rate_limits (token, created_at);

alter table public.invitation_email_rate_limits enable row level security;

-- Allows at most 3 send attempts per invitation token within any
-- rolling 10-minute window - enough for a legitimate "didn't arrive,
-- try again" retry or two, not enough to be a useful spam/harassment
-- vector against the invited person.
create or replace function public.check_invitation_email_rate_limit(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count integer;
begin
  if p_token is null or length(p_token) = 0 then
    return false;
  end if;

  delete from public.invitation_email_rate_limits
  where created_at < now() - interval '1 hour';

  select count(*) into v_recent_count
  from public.invitation_email_rate_limits
  where token = p_token
    and created_at > now() - interval '10 minutes';

  if v_recent_count >= 3 then
    return false;
  end if;

  insert into public.invitation_email_rate_limits (token) values (p_token);

  return true;
end;
$$;

grant execute on function public.check_invitation_email_rate_limit(text) to anon, authenticated;
