import { describe, expect, it } from "vitest";

import {
  PRIMARY_ODONTOGRAM_MAX_TEETH,
  primaryToothToVendorId,
  vendorFdiToPrimaryTooth,
} from "./vendorPrimaryTeeth";

describe("primaryToothToVendorId", () => {
  it("maps every primary quadrant to the correct vendor quadrant digit", () => {
    expect(primaryToothToVendorId(51)).toBe("teeth-11");
    expect(primaryToothToVendorId(61)).toBe("teeth-21");
    expect(primaryToothToVendorId(71)).toBe("teeth-31");
    expect(primaryToothToVendorId(81)).toBe("teeth-41");
  });

  it("preserves the position digit unchanged", () => {
    expect(primaryToothToVendorId(51)).toBe("teeth-11");
    expect(primaryToothToVendorId(52)).toBe("teeth-12");
    expect(primaryToothToVendorId(53)).toBe("teeth-13");
    expect(primaryToothToVendorId(54)).toBe("teeth-14");
    expect(primaryToothToVendorId(55)).toBe("teeth-15");
  });
});

describe("vendorFdiToPrimaryTooth", () => {
  it("is the exact inverse of primaryToothToVendorId for every primary tooth", () => {
    const allPrimaryTeeth = [
      51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85,
    ];

    for (const primaryTooth of allPrimaryTeeth) {
      const vendorId = primaryToothToVendorId(primaryTooth);
      const vendorFdi = Number(vendorId.replace("teeth-", ""));
      expect(vendorFdiToPrimaryTooth(vendorFdi)).toBe(primaryTooth);
    }
  });

  it("never collides with an actual permanent tooth number", () => {
    // The vendor always reports numbers in the 11-45 range while maxTeeth
    // is capped at 5 - converting those back to primary numbers must land
    // in 51-85, entirely outside the real 11-48 permanent range.
    for (let vendorFdi = 11; vendorFdi <= 45; vendorFdi++) {
      const primary = vendorFdiToPrimaryTooth(vendorFdi);
      expect(primary).toBeGreaterThanOrEqual(51);
      expect(primary).toBeLessThanOrEqual(85);
    }
  });
});

describe("PRIMARY_ODONTOGRAM_MAX_TEETH", () => {
  it("is 5 - exactly the number of teeth in one primary quadrant", () => {
    expect(PRIMARY_ODONTOGRAM_MAX_TEETH).toBe(5);
  });
});
