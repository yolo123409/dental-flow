/**
 * One-time/idempotent admin import of the official CMS ICD-10-CM
 * "Code Descriptions in Tabular Order" reference file into the existing
 * clinical_codes table (see supabase/migrations/0054_clinical_coding.sql).
 *
 * This is reference data only - it never touches patients, appointments,
 * treatment plans, charges, invoices, payments, or any patient_* coding
 * attachment table, and it never imports CDT or CPT data (both require a
 * license this project does not have).
 *
 * Run locally with:
 *   node scripts/import-icd10cm.js
 *
 * Requires (in .env.local, never committed): NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. The service-role key is read here, in a
 * plain Node script, and is never bundled into client/browser code.
 *
 * Source file: data/icd10cm_codes_2026.txt (not tracked in git - see
 * data/README.md for provenance and how to obtain it). Format is CMS's
 * standard fixed-width layout: an 8-character code field (the code,
 * left-justified and padded with trailing spaces) followed directly by
 * the short description, e.g.:
 *   A000    Cholera due to Vibrio cholerae 01, biovar cholerae
 *   K0251   Dental caries on pit and fissure surface limited to enamel
 *
 * Code format decision: the CMS file stores codes without the decimal
 * point (billing/X12 form). This app has no code-formatting/display
 * layer anywhere (ClinicalCodePicker and CodedDiagnosisList render
 * `code.code` verbatim) and search is a plain `ilike` substring match on
 * the raw `code` column (services/clinicalCodes.ts#searchClinicalCodes).
 * Storing the undotted form would silently break the conventional
 * clinical search "K02.9" (it would never match "K029"). So codes are
 * normalized here to the standard ICD-10-CM tabular/display form - a
 * "." inserted after the 3-character category for any code longer than
 * 3 characters (A000 -> A00.0, K0251 -> K02.51; A09 stays A09, since a
 * 3-character category code has no subdivision to separate).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "data", "icd10cm_codes_2026.txt");
const CODE_SYSTEM = "ICD-10-CM";
const BATCH_SIZE = 500;

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

function toDottedCode(rawCode) {
  if (rawCode.length <= 3) return rawCode;
  return `${rawCode.slice(0, 3)}.${rawCode.slice(3)}`;
}

const CODE_FIELD_WIDTH = 8;
const RAW_CODE_PATTERN = /^[A-Z][A-Z0-9]{2,6}$/;

function parseSourceFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r\n|\n|\r/).filter((line) => line.length > 0);

  const byCode = new Map(); // dottedCode -> shortDescription (first occurrence)
  let malformed = 0;
  let emptyDescription = 0;
  let duplicates = 0;
  const malformedExamples = [];
  const duplicateExamples = [];

  for (const line of lines) {
    if (line.length <= CODE_FIELD_WIDTH) {
      malformed++;
      if (malformedExamples.length < 5) malformedExamples.push(line);
      continue;
    }

    const rawCode = line.slice(0, CODE_FIELD_WIDTH).trimEnd();
    const description = line.slice(CODE_FIELD_WIDTH).trim();

    if (!RAW_CODE_PATTERN.test(rawCode)) {
      malformed++;
      if (malformedExamples.length < 5) malformedExamples.push(line);
      continue;
    }
    if (!description) {
      emptyDescription++;
      continue;
    }

    const code = toDottedCode(rawCode);

    if (byCode.has(code)) {
      duplicates++;
      if (duplicateExamples.length < 5) {
        duplicateExamples.push({ code, first: byCode.get(code), duplicate: description });
      }
      continue;
    }

    byCode.set(code, description);
  }

  return {
    totalLines: lines.length,
    malformed,
    malformedExamples,
    emptyDescription,
    duplicates,
    duplicateExamples,
    byCode,
  };
}

async function fetchExistingIcdCodes(admin) {
  const existing = new Map(); // code -> short_description
  const pageSize = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await admin
      .from("clinical_codes")
      .select("code, short_description")
      .eq("code_system", CODE_SYSTEM)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) existing.set(row.code, row.short_description);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return existing;
}

async function getCount(admin, codeSystem) {
  const { count, error } = await admin
    .from("clinical_codes")
    .select("*", { count: "exact", head: true })
    .eq("code_system", codeSystem);

  if (error) throw error;
  return count ?? 0;
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local. Aborting."
    );
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`Source file not found: ${SOURCE_FILE}`);
    process.exitCode = 1;
    return;
  }

  const { createClient } = require("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Preflight: confirm migration 0054 has been applied before touching anything.
  const preflight = await admin.from("clinical_codes").select("id", { head: true, count: "exact" }).limit(1);
  if (preflight.error) {
    const code = preflight.error.code;
    const message = preflight.error.message || "";
    if (code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(message)) {
      console.error("Apply migration 0054 first.");
      process.exitCode = 1;
      return;
    }
    throw preflight.error;
  }

  console.log(`Parsing ${SOURCE_FILE} ...`);
  const parsed = parseSourceFile(SOURCE_FILE);

  console.log("--- Source parse summary ---");
  console.log("Total source lines:        ", parsed.totalLines);
  console.log("Malformed records:         ", parsed.malformed);
  console.log("Duplicate source codes:    ", parsed.duplicates);
  console.log("Records without description:", parsed.emptyDescription);
  console.log("Valid unique parsed codes: ", parsed.byCode.size);
  if (parsed.malformedExamples.length) {
    console.log("Malformed examples:", parsed.malformedExamples);
  }
  if (parsed.duplicateExamples.length) {
    console.log("Duplicate examples:", parsed.duplicateExamples);
  }

  const [icdBefore, cdtBefore, cptBefore] = await Promise.all([
    getCount(admin, "ICD-10-CM"),
    getCount(admin, "CDT"),
    getCount(admin, "CPT"),
  ]);

  console.log("--- Database counts before import ---");
  console.log("ICD-10-CM:", icdBefore, " CDT:", cdtBefore, " CPT:", cptBefore);

  console.log("Fetching existing ICD-10-CM rows for conflict detection ...");
  const existing = await fetchExistingIcdCodes(admin);
  console.log("Existing ICD-10-CM rows fetched:", existing.size);

  const toInsert = [];
  let alreadyMatching = 0;
  const conflicts = [];

  for (const [code, description] of parsed.byCode) {
    if (!existing.has(code)) {
      toInsert.push({
        code_system: CODE_SYSTEM,
        code,
        short_description: description,
        long_description: null,
        category: null,
        active: true,
      });
      continue;
    }

    const existingDescription = existing.get(code);
    if (existingDescription === description) {
      alreadyMatching++;
    } else {
      conflicts.push({ code, existing: existingDescription, source: description });
    }
  }

  console.log("--- Import plan ---");
  console.log("New codes to insert:      ", toInsert.length);
  console.log("Already present (match):  ", alreadyMatching);
  console.log("Conflicts (not written):  ", conflicts.length);
  if (conflicts.length) {
    console.log("Conflict examples (first 10):", conflicts.slice(0, 10));
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    console.log(`Inserting ${toInsert.length} new ICD-10-CM codes in batches of ${BATCH_SIZE} ...`);
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const { error } = await admin
        .from("clinical_codes")
        .upsert(batch, { onConflict: "code_system,code", ignoreDuplicates: true });

      if (error) throw error;
      inserted += batch.length;
      process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
    }
    console.log(`\nInsert complete: ${inserted} rows.`);
  } else {
    console.log("Nothing to insert - all source codes already present.");
  }

  const [icdAfter, cdtAfter, cptAfter] = await Promise.all([
    getCount(admin, "ICD-10-CM"),
    getCount(admin, "CDT"),
    getCount(admin, "CPT"),
  ]);

  console.log("--- Database counts after import ---");
  console.log("ICD-10-CM:", icdAfter, " CDT:", cdtAfter, " CPT:", cptAfter);

  console.log("--- Summary ---");
  console.log(
    JSON.stringify(
      {
        sourceRecordsParsed: parsed.totalLines,
        malformed: parsed.malformed,
        duplicateSourceCodes: parsed.duplicates,
        icdBefore,
        inserted,
        alreadyMatching,
        conflicts: conflicts.length,
        icdAfter,
        cdtAfter,
        cptAfter,
      },
      null,
      2
    )
  );

  if (conflicts.length > 0) {
    console.warn(
      `WARNING: ${conflicts.length} existing ICD-10-CM code(s) had a description differing from the CMS source. None were overwritten - review manually.`
    );
  }
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exitCode = 1;
});
