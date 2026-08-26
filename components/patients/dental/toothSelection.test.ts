import { describe, expect, it } from "vitest";

import {
  ALL_PRIMARY_TEETH,
  ALL_TEETH,
  LOWER_ARCH,
  LOWER_LEFT,
  LOWER_RIGHT,
  PRIMARY_LOWER_ARCH,
  PRIMARY_LOWER_LEFT,
  PRIMARY_LOWER_RIGHT,
  PRIMARY_UPPER_ARCH,
  PRIMARY_UPPER_LEFT,
  PRIMARY_UPPER_RIGHT,
  UPPER_ARCH,
  UPPER_LEFT,
  UPPER_RIGHT,
  describeSelection,
  getPrimaryQuadrant,
  getQuadrant,
  isValidPrimaryTooth,
  isValidTooth,
  removeFromSelection,
  selectAllTeeth,
  selectArch,
  selectQuadrant,
  sortedTeeth,
  toggleTooth,
} from "./toothSelection";

describe("FDI numbering", () => {
  it("has exactly 32 unique teeth across all quadrants", () => {
    expect(ALL_TEETH).toHaveLength(32);
    expect(new Set(ALL_TEETH).size).toBe(32);
  });

  it("assigns each quadrant exactly 8 teeth, in the correct FDI ranges", () => {
    expect(UPPER_RIGHT).toEqual([18, 17, 16, 15, 14, 13, 12, 11]);
    expect(UPPER_LEFT).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
    expect(LOWER_LEFT).toEqual([31, 32, 33, 34, 35, 36, 37, 38]);
    expect(LOWER_RIGHT).toEqual([48, 47, 46, 45, 44, 43, 42, 41]);
  });

  it("builds arches from the correct quadrant pairs", () => {
    expect(UPPER_ARCH).toHaveLength(16);
    expect(LOWER_ARCH).toHaveLength(16);
    expect(new Set(UPPER_ARCH)).toEqual(
      new Set([...UPPER_RIGHT, ...UPPER_LEFT])
    );
    expect(new Set(LOWER_ARCH)).toEqual(
      new Set([...LOWER_RIGHT, ...LOWER_LEFT])
    );
  });

  it("classifies every tooth into its correct quadrant", () => {
    expect(getQuadrant(11)).toBe("UR");
    expect(getQuadrant(18)).toBe("UR");
    expect(getQuadrant(21)).toBe("UL");
    expect(getQuadrant(28)).toBe("UL");
    expect(getQuadrant(31)).toBe("LL");
    expect(getQuadrant(38)).toBe("LL");
    expect(getQuadrant(41)).toBe("LR");
    expect(getQuadrant(48)).toBe("LR");
  });

  it("rejects tooth numbers that don't exist in the FDI adult chart", () => {
    expect(isValidTooth(0)).toBe(false);
    expect(isValidTooth(19)).toBe(false);
    expect(isValidTooth(51)).toBe(false);
    expect(getQuadrant(99)).toBeNull();
  });
});

describe("toggleTooth - Set semantics", () => {
  it("adds an unselected tooth", () => {
    const result = toggleTooth(new Set(), 16);
    expect(sortedTeeth(result)).toEqual([16]);
  });

  it("removes an already-selected tooth", () => {
    const result = toggleTooth(new Set([16]), 16);
    expect(result.size).toBe(0);
  });

  it("never produces duplicates when the same tooth is toggled twice", () => {
    const first = toggleTooth(new Set(), 16);
    const second = toggleTooth(first, 16);
    expect(second.size).toBe(0);
  });

  it("does not mutate the input set", () => {
    const original = new Set([16]);
    toggleTooth(original, 17);
    expect(sortedTeeth(original)).toEqual([16]);
  });
});

describe("multi-selection", () => {
  it("builds up a selection of individual teeth and reports the correct count", () => {
    let selection = new Set<number>();
    selection = toggleTooth(selection, 16);
    selection = toggleTooth(selection, 17);
    selection = toggleTooth(selection, 18);

    expect(selection.size).toBe(3);
    expect(sortedTeeth(selection)).toEqual([16, 17, 18]);
  });

  it("removing one tooth from a multi-selection leaves the rest intact", () => {
    let selection = new Set([16, 17, 18]);
    selection = removeFromSelection(selection, 17);

    expect(selection.size).toBe(2);
    expect(sortedTeeth(selection)).toEqual([16, 18]);
  });

  it("combines a quadrant selection with one extra tooth", () => {
    const quadrant = selectQuadrant("UR");
    const combined = toggleTooth(quadrant, 21);

    expect(combined.size).toBe(9);
    expect(sortedTeeth(combined)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 21]);
  });
});

describe("quadrant selection", () => {
  it("selects exactly 8 teeth per quadrant", () => {
    expect(selectQuadrant("UR").size).toBe(8);
    expect(selectQuadrant("UL").size).toBe(8);
    expect(selectQuadrant("LL").size).toBe(8);
    expect(selectQuadrant("LR").size).toBe(8);
  });

  it("selects the correct teeth for each quadrant", () => {
    expect(sortedTeeth(selectQuadrant("UR"))).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(sortedTeeth(selectQuadrant("UL"))).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
    expect(sortedTeeth(selectQuadrant("LL"))).toEqual([31, 32, 33, 34, 35, 36, 37, 38]);
    expect(sortedTeeth(selectQuadrant("LR"))).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
  });
});

describe("arch selection", () => {
  it("selects exactly 16 teeth per arch and 32 for all teeth", () => {
    expect(selectArch("upper").size).toBe(16);
    expect(selectArch("lower").size).toBe(16);
    expect(selectAllTeeth().size).toBe(32);
  });

  it("upper and lower arches never overlap and together cover all teeth", () => {
    const upper = selectArch("upper");
    const lower = selectArch("lower");

    for (const tooth of upper) {
      expect(lower.has(tooth)).toBe(false);
    }

    const union = new Set([...upper, ...lower]);
    expect(union.size).toBe(32);
    expect(union).toEqual(selectAllTeeth());
  });
});

describe("clear selection", () => {
  it("results in a selection of size 0", () => {
    const cleared = new Set<number>();
    expect(cleared.size).toBe(0);
    expect(sortedTeeth(cleared)).toEqual([]);
  });
});

describe("describeSelection", () => {
  it("describes zero, one, and many teeth", () => {
    expect(describeSelection(new Set())).toBe("No teeth selected");
    expect(describeSelection(new Set([16]))).toBe("1 tooth selected");
    expect(describeSelection(new Set([16, 17, 18]))).toBe("3 teeth selected");
  });

  it("names an exact quadrant, arch, or full-dentition match", () => {
    expect(describeSelection(selectQuadrant("UR"))).toBe("Upper Right selected · 8 teeth");
    expect(describeSelection(selectArch("upper"))).toBe("Upper arch selected · 16 teeth");
    expect(describeSelection(selectArch("lower"))).toBe("Lower arch selected · 16 teeth");
    expect(describeSelection(selectAllTeeth())).toBe("All teeth selected · 32 teeth");
  });

  it("falls back to a plain count once a named group has been modified", () => {
    const modified = toggleTooth(selectQuadrant("UR"), 21);
    expect(describeSelection(modified)).toBe("9 teeth selected");
  });
});

describe("primary (deciduous) FDI numbering", () => {
  it("has exactly 20 unique teeth across all quadrants", () => {
    expect(ALL_PRIMARY_TEETH).toHaveLength(20);
    expect(new Set(ALL_PRIMARY_TEETH).size).toBe(20);
  });

  it("assigns each quadrant exactly 5 teeth, using the standard primary FDI ranges", () => {
    expect(PRIMARY_UPPER_RIGHT).toEqual([51, 52, 53, 54, 55]);
    expect(PRIMARY_UPPER_LEFT).toEqual([61, 62, 63, 64, 65]);
    expect(PRIMARY_LOWER_LEFT).toEqual([71, 72, 73, 74, 75]);
    expect(PRIMARY_LOWER_RIGHT).toEqual([81, 82, 83, 84, 85]);
  });

  it("builds primary arches from the correct quadrant pairs", () => {
    expect(PRIMARY_UPPER_ARCH).toHaveLength(10);
    expect(PRIMARY_LOWER_ARCH).toHaveLength(10);
    expect(new Set(PRIMARY_UPPER_ARCH)).toEqual(
      new Set([...PRIMARY_UPPER_RIGHT, ...PRIMARY_UPPER_LEFT])
    );
    expect(new Set(PRIMARY_LOWER_ARCH)).toEqual(
      new Set([...PRIMARY_LOWER_RIGHT, ...PRIMARY_LOWER_LEFT])
    );
  });

  it("classifies every primary tooth into its correct quadrant", () => {
    expect(getPrimaryQuadrant(51)).toBe("UR");
    expect(getPrimaryQuadrant(55)).toBe("UR");
    expect(getPrimaryQuadrant(61)).toBe("UL");
    expect(getPrimaryQuadrant(65)).toBe("UL");
    expect(getPrimaryQuadrant(71)).toBe("LL");
    expect(getPrimaryQuadrant(75)).toBe("LL");
    expect(getPrimaryQuadrant(81)).toBe("LR");
    expect(getPrimaryQuadrant(85)).toBe("LR");
  });

  it("rejects tooth numbers that don't exist in the primary FDI chart, including real permanent numbers", () => {
    expect(isValidPrimaryTooth(0)).toBe(false);
    expect(isValidPrimaryTooth(56)).toBe(false);
    expect(isValidPrimaryTooth(50)).toBe(false);
    // A permanent tooth number must never be mistaken for a primary one.
    expect(isValidPrimaryTooth(11)).toBe(false);
    expect(isValidPrimaryTooth(48)).toBe(false);
    expect(getPrimaryQuadrant(99)).toBeNull();
  });

  it("never overlaps with the permanent FDI range", () => {
    for (const tooth of ALL_PRIMARY_TEETH) {
      expect(isValidTooth(tooth)).toBe(false);
    }
    for (const tooth of ALL_TEETH) {
      expect(isValidPrimaryTooth(tooth)).toBe(false);
    }
  });

  it("selectQuadrant/selectArch/selectAllTeeth default to Permanent when dentition is omitted", () => {
    expect(sortedTeeth(selectQuadrant("UR"))).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(sortedTeeth(selectArch("upper"))).toEqual(sortedTeeth(new Set(UPPER_ARCH)));
    expect(selectAllTeeth().size).toBe(32);
  });

  it("selectQuadrant/selectArch/selectAllTeeth switch to the primary sets when dentition is Primary", () => {
    expect(sortedTeeth(selectQuadrant("UR", "Primary"))).toEqual([51, 52, 53, 54, 55]);
    expect(sortedTeeth(selectQuadrant("LR", "Primary"))).toEqual([81, 82, 83, 84, 85]);
    expect(sortedTeeth(selectArch("upper", "Primary"))).toEqual(
      sortedTeeth(new Set(PRIMARY_UPPER_ARCH))
    );
    expect(sortedTeeth(selectArch("lower", "Primary"))).toEqual(
      sortedTeeth(new Set(PRIMARY_LOWER_ARCH))
    );
    expect(selectAllTeeth("Primary").size).toBe(20);
    expect(sortedTeeth(selectAllTeeth("Primary"))).toEqual(sortedTeeth(new Set(ALL_PRIMARY_TEETH)));
  });
});
