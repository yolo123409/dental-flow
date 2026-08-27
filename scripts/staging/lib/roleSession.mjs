// FIN-4.2 — shared helpers for simulating a real, role-scoped Supabase
// session from a raw `pg` connection, against staging. This is the exact
// methodology FIN-3.5/3.8/3.10 used ad hoc, directly against production,
// made safe only by manual BEGIN/ROLLBACK discipline each time. Here it
// runs against RESTORE_TEST_DB_URL instead, formalized as a reusable
// module so it's not re-derived per script.
//
// Two distinct simulation levels, matched to what each check needs:
//   - actAs(): sets request.jwt.claims only. The connection stays the
//     superuser role, so RLS itself does not apply - but BEFORE triggers
//     (the role-guard triggers from FIN-3.8/0098, and every posting
//     trigger) fire regardless of role, since triggers are not RLS. This
//     is enough for every trigger/permission-guard check.
//   - actAsWithRls(): additionally SET LOCAL ROLE authenticated, so RLS
//     policies themselves are evaluated - needed only for genuine
//     cross-clinic/cross-branch isolation checks (RLS is what enforces
//     those, not a trigger). Scoped to the current transaction only
//     (SET LOCAL), and callers should follow with resetRole() before
//     any further superuser-only setup in the same transaction.

export async function actAs(client, authUserId) {
  await client.query(
    `select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
    [authUserId]
  );
}

export async function actAsWithRls(client, authUserId) {
  await client.query(
    `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [authUserId]
  );
  await client.query(`SET LOCAL ROLE authenticated`);
}

export async function resetRole(client) {
  await client.query(`RESET ROLE`);
}

let savepointCounter = 0;

/**
 * Runs `fn(client)` inside its own SAVEPOINT and returns { ok: true } on
 * success or { ok: false, error } on failure - never throws. A failed
 * statement aborts the whole enclosing transaction until rolled back to
 * a savepoint (a real Postgres property, not a mock), so every scenario
 * in a long-running suite - including ones that deliberately attempt
 * something that SHOULD fail - must be wrapped like this or one blocked
 * write would silently void every check after it.
 */
export async function attemptWithSavepoint(client, fn) {
  const sp = `sp_${savepointCounter++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await fn(client);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, error: null };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { ok: false, error };
  }
}
