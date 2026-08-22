// Read-only catalog introspection helpers, scoped to the `public` schema
// only (DentalFlow's application schema). Deliberately does NOT touch
// Supabase-managed internal schemas (auth, storage, realtime,
// supabase_functions, pgsodium, vault, extensions-internals) - those are
// provisioned by Supabase itself on any new project and are out of
// scope for an application-level backup, per the task's own guidance
// not to blindly dump unsupported Supabase-managed internals.

export async function listTables(client) {
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  );
  return rows.map((r) => r.tablename);
}

export async function listColumns(client, table) {
  const { rows } = await client.query(
    `select column_name, data_type, udt_name, is_nullable, ordinal_position
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`,
    [table]
  );
  return rows;
}

export async function listForeignKeys(client) {
  const { rows } = await client.query(`
    select conname, conrelid::regclass::text as "table", confrelid::regclass::text as "references"
    from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace
  `);
  return rows;
}

export async function listFunctions(client) {
  const { rows } = await client.query(`
    select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `);
  return rows;
}

export async function listIndexes(client) {
  const { rows } = await client.query(
    `select indexname, tablename, indexdef from pg_indexes where schemaname = 'public' order by indexname`
  );
  return rows;
}

export async function listConstraints(client) {
  const { rows } = await client.query(`
    select conname, conrelid::regclass::text as "table", contype, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where connamespace = 'public'::regnamespace
    order by conname
  `);
  return rows;
}

export async function listPolicies(client) {
  const { rows } = await client.query(
    `select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     from pg_policies where schemaname = 'public' order by tablename, policyname`
  );
  return rows;
}

export async function listRlsStatus(client) {
  const { rows } = await client.query(`
    select c.relname as "table", c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  return rows;
}

export async function listExtensions(client) {
  const { rows } = await client.query(`
    select e.extname, e.extversion, n.nspname as schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    order by e.extname
  `);
  return rows;
}

export async function dbStats(client) {
  const { rows } = await client.query(`
    select current_database() as db,
           pg_size_pretty(pg_database_size(current_database())) as size_pretty,
           pg_database_size(current_database()) as size_bytes,
           current_setting('server_version') as pg_version
  `);
  return rows[0];
}

/** Topologically sorts tables so FK parents come before children (Kahn's algorithm). Falls back to appending any cyclic remainder in arbitrary order. */
export function topoSortTables(tables, foreignKeys) {
  const inDegree = new Map(tables.map((t) => [t, 0]));
  const dependents = new Map(tables.map((t) => [t, []]));
  for (const fk of foreignKeys) {
    const child = fk.table.replace(/^public\./, "").replace(/"/g, "");
    const parent = fk.references.replace(/^public\./, "").replace(/"/g, "");
    if (child === parent) continue; // self-referencing FK, ignore for ordering
    if (!inDegree.has(child) || !inDegree.has(parent)) continue;
    dependents.get(parent).push(child);
    inDegree.set(child, inDegree.get(child) + 1);
  }
  const queue = tables.filter((t) => inDegree.get(t) === 0);
  const order = [];
  while (queue.length > 0) {
    const t = queue.shift();
    order.push(t);
    for (const dep of dependents.get(t)) {
      inDegree.set(dep, inDegree.get(dep) - 1);
      if (inDegree.get(dep) === 0) queue.push(dep);
    }
  }
  const remaining = tables.filter((t) => !order.includes(t));
  return [...order, ...remaining];
}
