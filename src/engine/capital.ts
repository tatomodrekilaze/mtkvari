import { isUnhedgedFx } from "./credit";
import type { Currency, Line, Policy } from "./types";

export interface CapitalInput {
  lines: Pick<Line, "side" | "amountGel" | "riskWeight" | "capitalClass">[];
  loans: {
    eadGel: number;
    riskWeight: number;
    currency: Currency;
    incomeCurrency: Currency;
    hedged: boolean;
  }[];
  openPosition: number;
  operationalRiskRwa: number;
  policy: Policy;
}

export interface CapitalResult {
  cet1Amount: number;
  at1Amount: number;
  tier2Amount: number;
  tier1Amount: number;
  totalAmount: number;
  creditRwa: number;
  marketRwa: number;
  operationalRwa: number;
  rwa: number;
  cet1Ratio: number;
  tier1Ratio: number;
  totalRatio: number;
  unhedgedEad: number;
  cicrCapital: number;
  cicrRatio: number;
  addOns: number;
  minimumCet1: number;
  minimumTier1: number;
  minimumTotal: number;
}

export function ownFunds(lines: Pick<Line, "amountGel" | "capitalClass">[]): {
  cet1: number;
  at1: number;
  tier2: number;
  total: number;
} {
  let cet1 = 0;
  let at1 = 0;
  let tier2 = 0;
  for (const line of lines) {
    if (line.capitalClass === "cet1") cet1 += line.amountGel;
    if (line.capitalClass === "at1") at1 += line.amountGel;
    if (line.capitalClass === "tier2") tier2 += line.amountGel;
  }
  return { cet1, at1, tier2, total: cet1 + at1 + tier2 };
}

export function capitalPosition(input: CapitalInput): CapitalResult {
  const funds = ownFunds(input.lines);
  let creditRwa = 0;
  for (const line of input.lines) {
    if (line.side === "asset") creditRwa += line.amountGel * (line.riskWeight ?? 0);
  }
  let unhedgedEad = 0;
  for (const loan of input.loans) {
    creditRwa += loan.eadGel * loan.riskWeight;
    if (isUnhedgedFx(loan)) unhedgedEad += loan.eadGel;
  }

  const marketRwa = 12.5 * input.policy.fxCharge * input.openPosition;
  const operationalRwa = input.operationalRiskRwa;
  const rwa = creditRwa + marketRwa + operationalRwa;
  const cicrCapital = unhedgedEad * input.policy.cicrExtraRiskWeight * input.policy.pillar1Total;
  const cicrRatio = rwa > 0 ? cicrCapital / rwa : 0;
  const addOns =
    input.policy.conservation +
    input.policy.countercyclical +
    input.policy.systemic +
    input.policy.pillar2 +
    cicrRatio;

  const ratio = (amount: number) => (rwa > 0 ? amount / rwa : 0);

  return {
    cet1Amount: funds.cet1,
    at1Amount: funds.at1,
    tier2Amount: funds.tier2,
    tier1Amount: funds.cet1 + funds.at1,
    totalAmount: funds.total,
    creditRwa,
    marketRwa,
    operationalRwa,
    rwa,
    cet1Ratio: ratio(funds.cet1),
    tier1Ratio: ratio(funds.cet1 + funds.at1),
    totalRatio: ratio(funds.total),
    unhedgedEad,
    cicrCapital,
    cicrRatio,
    addOns,
    minimumCet1: input.policy.pillar1Cet1 + addOns,
    minimumTier1: input.policy.pillar1Tier1 + addOns,
    minimumTotal: input.policy.pillar1Total + addOns,
  };
}
