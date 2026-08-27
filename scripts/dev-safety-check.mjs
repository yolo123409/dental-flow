// FIN-4.6 — runs before every `npm run dev` (see package.json "predev").
//
// WHAT THIS DOES NOT DO: stop local development from touching
// production. It can't - docs/ENVIRONMENTS.md §4 already documents why:
// a genuinely separate Development-tier Supabase project requires
// external account action (creating a new Supabase project) this
// repository cannot perform, and there is currently no second project
// to point local dev at even if this script wanted to. Blocking `npm
// run dev` outright would just break the only working setup that
// exists today, which is explicitly out of scope ("do not introduce
// unnecessary friction into normal ... deployment").
//
// WHAT THIS DOES: makes sure nobody starts a local dev session against
// real patient/financial data without knowing that's what's happening.
// Non-blocking by design - always exits 0.
import "./backup/lib/env.mjs"; // side effect only: loads .env.local into process.env, same as every other script here

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ref = (() => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
})();

console.log("");
console.log("############################################################");
console.log("#  npm run dev is about to connect to:");
console.log(`#    ${ref ? `project ref: ${ref}` : "(NEXT_PUBLIC_SUPABASE_URL not set)"}`);
console.log("#");
console.log("#  There is no separate Development database yet - this is");
console.log("#  the SAME project real patients/invoices/payments live in.");
console.log("#  See docs/ENVIRONMENTS.md #4 for what closing this gap");
console.log("#  requires. Until then, treat every local change as if it");
console.log("#  can touch real data - because it can.");
console.log("############################################################");
console.log("");
