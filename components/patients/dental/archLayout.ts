export interface ToothPosition {
  x: number;
  y: number;
}

export const upperArch: Record<number, ToothPosition> = {
  18: { x: 0, y: 28 },
  17: { x: 1, y: 18 },
  16: { x: 2, y: 10 },
  15: { x: 3, y: 4 },
  14: { x: 4, y: 4 },
  13: { x: 5, y: 10 },
  12: { x: 6, y: 18 },
  11: { x: 7, y: 28 },

  21: { x: 9, y: 28 },
  22: { x: 10, y: 18 },
  23: { x: 11, y: 10 },
  24: { x: 12, y: 4 },
  25: { x: 13, y: 4 },
  26: { x: 14, y: 10 },
  27: { x: 15, y: 18 },
  28: { x: 16, y: 28 },
};

export const lowerArch: Record<number, ToothPosition> = {
  48: { x: 0, y: 0 },
  47: { x: 1, y: 10 },
  46: { x: 2, y: 18 },
  45: { x: 3, y: 24 },
  44: { x: 4, y: 24 },
  43: { x: 5, y: 18 },
  42: { x: 6, y: 10 },
  41: { x: 7, y: 0 },

  31: { x: 9, y: 0 },
  32: { x: 10, y: 10 },
  33: { x: 11, y: 18 },
  34: { x: 12, y: 24 },
  35: { x: 13, y: 24 },
  36: { x: 14, y: 18 },
  37: { x: 15, y: 10 },
  38: { x: 16, y: 0 },
};