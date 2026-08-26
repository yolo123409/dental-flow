"use client";

import { useCallback, useMemo, useState } from "react";

import {
  Arch,
  Dentition,
  Quadrant,
  removeFromSelection,
  selectAllTeeth,
  selectArch,
  selectQuadrant,
  sortedTeeth,
} from "./toothSelection";

/**
 * Owns the odontogram's selection state.
 *
 * The vendored `Odontogram` component is uncontrolled (it only reads
 * `defaultSelected` once, on mount) - so there are two distinct ways a
 * selection change can happen:
 *
 * 1. The user clicks a tooth directly on the chart. The vendor component
 *    updates its own internal state and reports the full new selection
 *    via `onChange` - `syncFromOdontogram` just mirrors that here.
 * 2. The user uses a toolbar control (Select All, a quadrant/arch
 *    shortcut, Clear, or removing a chip). That's driven from *outside*
 *    the vendor component, which has no way to know about it - so
 *    `remountKey` is bumped, forcing the vendor component to remount and
 *    re-read `defaultSelected` from the new state.
 *
 * `dentition` picks which FDI range the quick-select actions (Select
 * All, an arch, a quadrant) draw from - Permanent (11-48) or Primary
 * (51-85). It has no effect on selectOne/selectMany/syncFromOdontogram,
 * which just take whatever tooth numbers they're given.
 */
export function useToothSelection(
  initial: readonly number[] = [],
  dentition: Dentition = "Permanent"
) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initial)
  );

  const [remountKey, setRemountKey] = useState(0);

  const applyExternal = useCallback((next: Set<number>) => {
    setSelected(next);
    setRemountKey((key) => key + 1);
  }, []);

  const syncFromOdontogram = useCallback((teeth: number[]) => {
    setSelected(new Set(teeth));
  }, []);

  const selectOne = useCallback(
    (tooth: number) => {
      applyExternal(new Set([tooth]));
    },
    [applyExternal]
  );

  // Phase E section 10: selects every tooth belonging to one Treatment at
  // once (e.g. a grouped Treatment's 16/17/18), the multi-tooth
  // counterpart to selectOne - reuses the same external-apply path, so it
  // remounts the vendor odontogram exactly like every other toolbar-driven
  // selection change already does.
  const selectMany = useCallback(
    (teeth: readonly number[]) => {
      applyExternal(new Set(teeth));
    },
    [applyExternal]
  );

  const removeTooth = useCallback(
    (tooth: number) => {
      applyExternal(removeFromSelection(selected, tooth));
    },
    [applyExternal, selected]
  );

  const handleSelectQuadrant = useCallback(
    (quadrant: Quadrant) => {
      applyExternal(selectQuadrant(quadrant, dentition));
    },
    [applyExternal, dentition]
  );

  const handleSelectArch = useCallback(
    (arch: Arch) => {
      applyExternal(selectArch(arch, dentition));
    },
    [applyExternal, dentition]
  );

  const handleSelectAll = useCallback(() => {
    applyExternal(selectAllTeeth(dentition));
  }, [applyExternal, dentition]);

  const clear = useCallback(() => {
    applyExternal(new Set());
  }, [applyExternal]);

  const selectedList = useMemo(() => sortedTeeth(selected), [selected]);

  return {
    selected,
    selectedList,
    remountKey,
    syncFromOdontogram,
    selectOne,
    selectMany,
    removeTooth,
    selectQuadrant: handleSelectQuadrant,
    selectArch: handleSelectArch,
    selectAll: handleSelectAll,
    clear,
  };
}

export type ToothSelection = ReturnType<typeof useToothSelection>;
