-- Full-app audit fix H17: "My Profile" (/admin/users/[id]) is gated by
-- the "users" permission (Owner/Admin only), so every Dentist/
-- Receptionist hits Access Denied trying to view or edit their OWN
-- name/phone. clinic_users has a leftover "Users can update their own
-- profile" RLS policy, but it compares id = auth.uid() - id is a
-- server-generated primary key unrelated to the auth user's id, so it
-- never actually matches; there is no real self-update path today.
--
-- A naive self-UPDATE RLS policy was deliberately avoided (see migration
-- 0060's header) because it would let staff rewrite their own role or
-- clinic_id. THE FIX instead: a narrow SECURITY DEFINER RPC that only
-- ever touches full_name/phone, only on row(s) owned by the caller's own
-- auth.uid() - never a client-supplied id, so there's no privilege-
-- escalation surface and no new RLS policy is needed.
--
-- Updates every clinic_users row this person has (not just whichever
-- branch is currently active) - a multi-branch Member can hold one row
-- per branch (migration 0055), and a display name/phone are person-level
-- attributes, not branch-level ones.

create or replace function public.update_own_profile(
  p_full_name text,
  p_phone text
)
returns setof public.clinic_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;

  if trim(coalesce(p_full_name, '')) = '' then
    raise exception 'Full name cannot be empty.';
  end if;

  return query
    update public.clinic_users
    set full_name = trim(p_full_name),
        phone = nullif(trim(coalesce(p_phone, '')), '')
    where auth_user_id = v_uid
    returning *;
end;
$$;

grant execute on function public.update_own_profile(text, text) to authenticated;
