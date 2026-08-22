import { toError } from "./logError";

/**
 * Supabase/PostgREST caps any unbounded `.select()` at a default max-rows
 * limit (1,000 on this project) - silently, with no error, and with
 * `count: 'exact'` still reporting the true total correctly while the
 * actual row data is cut off. Found live during the 50-branch scale test:
 * a plain `.select('clinic_id').in('clinic_id', branchIds)` over 2,000
 * real patient rows came back as exactly 1,000, with nothing in the
 * response to indicate truncation happened.
 *
 * For call sites where the right fix is "aggregate this in SQL instead"
 * (an RPC that returns one row per branch/group, not one per record),
 * that's always the better fix - see migration 0065's org-financials
 * RPCs. This helper is for the remaining, narrower case: a genuinely
 * unbounded set of individual rows actually needs to reach the caller
 * (not just a sum/count of them), where paging through in fixed-size
 * chunks via `.range()` is the correct fix rather than raising the cap
 * with a single arbitrary `.limit()` that would just move the same
 * silent-truncation risk to a bigger number.
 *
 * `buildQuery(from, to)` must apply the SAME filters/order on every call
 * - only the range differs - and should include an explicit `.order()`
 * so page boundaries are stable (PostgREST does not guarantee row order
 * across pages without one).
 */
export async function fetchAllRows<T>(
  buildQuery: (
    rangeFrom: number,
    rangeTo: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);

    if (error) {
      throw toError(error);
    }

    const page = data ?? [];

    all.push(...page);

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return all;
}
