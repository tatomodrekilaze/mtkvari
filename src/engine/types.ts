export type Currency = "GEL" | "USD" | "EUR";

export const CURRENCIES = ["GEL", "USD", "EUR"] as const;

export interface CashSlice {
  tYears: number;
  fraction: number;
}

export interface Line {
  id: string;
  name: string;
  side: "asset" | "liability" | "equity";
  currency: Currency;
  amountGel: number;
  hqla?: { level: "L1" | "L2A"; haircut: number };
  /** Share of the balance that runs off inside 30 days. */
  lcrOutflow?: number;
  /** Recognizable 30-day inflow, already after the product cap. Not set on buffer assets. */
  lcrInflow?: number;
  /** Available stable funding factor. Liabilities and equity. */
  asf?: number;
  /** Required stable funding factor. Assets. */
  rsf?: number;
  riskWeight?: number;
  capitalClass?: "cet1" | "at1" | "tier2";
  /** Principal by next repricing date. Fractions sum to 1. Equity is omitted. */
  cashFlows?: CashSlice[];
}

export interface Loan {
  id: string;
  name: string;
  currency: Currency;
  incomeCurrency: Currency;
  hedged: boolean;
  /** False for a portfolio rollup. The lari-loan rule is checked on single facilities. */
  facility: boolean;
  eadGel: number;
  lgd: number;
  eir: number;
  maturityYears: number;
  dsrOrigination: number;
  dsrCurrent: number;
  daysPastDue: number;
  riskWeight: number;
  rsf: number;
  lcrInflow: number;
  cashFlows: CashSlice[];
}

export interface Forward {
  id: string;
  name: string;
  currency: Exclude<Currency, "GEL">;
  /** Positive: the bank buys this currency against lari. GEL equivalent at the book rate. */
  buyGel: number;
}

export interface Policy {
  fxLimit: number;
  lcrFloorAll: number;
  lcrFloorGel: number;
  lcrFloorFx: number;
  nsfrFloor: number;
  eveLimit: number;
  pillar1Cet1: number;
  pillar1Tier1: number;
  pillar1Total: number;
  conservation: number;
  countercyclical: number;
  systemic: number;
  pillar2: number;
  /** Extra risk weight on unhedged FX exposure. Illustrative until replaced with the NBG schedule. */
  cicrExtraRiskWeight: number;
  larizationCapGel: number;
  /** Added to LGD, per 100% depreciation, for an unhedged cross-currency borrower. */
  lgdUpliftPerDepreciation: number;
  pdIntercept: number;
  pdSlope: number;
  rateFloor: number;
  /** Standardized FX capital charge. Basel simplified method uses 8%. */
  fxCharge: number;
}

export interface ShockSpec {
  parallel: number;
  short: number;
  long: number;
}

export interface BookMeta {
  bank: string;
  asOf: string;
  rateNote: string;
}

export interface Book {
  meta: BookMeta;
  /** Flat reference curves. GEL is the NBG refinancing rate. USD and EUR are illustrative. */
  referenceRates: Record<Currency, number>;
  shocks: Record<Currency, ShockSpec>;
  operationalRiskRwa: number;
  /** 0 on the reported book. Set by the lari revaluation. */
  depreciation: number;
  policy: Policy;
  lines: Line[];
  loans: Loan[];
  forwards: Forward[];
}
