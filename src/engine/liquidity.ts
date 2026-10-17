export interface FactorPiece {
  amountGel: number;
  hqla?: { level: "L1" | "L2A"; haircut: number };
  lcrOutflow?: number;
  lcrInflow?: number;
  asf?: number;
  rsf?: number;
}

export interface Coverage {
  level1: number;
  level2aGross: number;
  level2a: number;
  hqla: number;
  outflows: number;
  inflows: number;
  inflowsCounted: number;
  netOutflow: number;
  ratio: number;
  floor: number;
}

export interface Funding {
  available: number;
  required: number;
  ratio: number;
  floor: number;
}

/**
 * Level 2 is capped at 40% of the buffer, which means it cannot exceed two-thirds of Level 1.
 * The cap is applied to the set of pieces passed in, so a currency and the consolidated book
 * are capped separately.
 */
export function coverage(pieces: FactorPiece[], floor: number): Coverage {
  let level1 = 0;
  let level2aGross = 0;
  let outflows = 0;
  let inflows = 0;

  for (const piece of pieces) {
    if (piece.hqla) {
      const afterHaircut = piece.amountGel * (1 - piece.hqla.haircut);
      if (piece.hqla.level === "L1") level1 += afterHaircut;
      else level2aGross += afterHaircut;
    } else if (piece.lcrInflow) {
      inflows += piece.amountGel * piece.lcrInflow;
    }
    if (piece.lcrOutflow) outflows += piece.amountGel * piece.lcrOutflow;
  }

  const level2a = Math.min(level2aGross, (2 / 3) * level1);
  const hqla = level1 + level2a;
  const inflowsCounted = Math.min(inflows, 0.75 * outflows);
  const netOutflow = outflows - inflowsCounted;
  const ratio = netOutflow <= 0 ? Number.POSITIVE_INFINITY : hqla / netOutflow;

  return {
    level1,
    level2aGross,
    level2a,
    hqla,
    outflows,
    inflows,
    inflowsCounted,
    netOutflow,
    ratio,
    floor,
  };
}

export function funding(pieces: FactorPiece[], floor: number): Funding {
  let available = 0;
  let required = 0;
  for (const piece of pieces) {
    if (piece.asf) available += piece.amountGel * piece.asf;
    if (piece.rsf) required += piece.amountGel * piece.rsf;
  }
  const ratio = required <= 0 ? Number.POSITIVE_INFINITY : available / required;
  return { available, required, ratio, floor };
}
