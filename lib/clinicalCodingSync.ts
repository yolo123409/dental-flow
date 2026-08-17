import { SyncableItem } from "@/types/clinicalCodes";

/**
 * Generic "diff a locally-edited list against what was originally loaded,
 * then issue the minimum adds/removes" helper - shared by every clinical
 * coding integration point (Tooth Details, Treatment Plan items) so the
 * same save-flow logic isn't duplicated per form. Never updates an
 * existing row in place; a changed selection is modeled as remove + add,
 * which matches how these attachment tables are used (see migration
 * 0054_clinical_coding.sql).
 */
export type { SyncableItem };

export async function syncAttachedItems<T extends SyncableItem>(
  current: T[],
  original: T[],
  addFn: (item: T) => Promise<string>,
  removeFn: (id: string) => Promise<void>
): Promise<void> {
  const currentExistingIds = new Set(
    current.filter((item) => item.existingId != null).map((item) => item.existingId as string)
  );

  const toRemove = original.filter(
    (item) => item.existingId != null && !currentExistingIds.has(item.existingId)
  );
  const toAdd = current.filter((item) => item.existingId == null);

  await Promise.all([
    ...toRemove.map((item) => removeFn(item.existingId as string)),
    ...toAdd.map((item) => addFn(item)),
  ]);
}
