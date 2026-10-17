import type { Book, Currency } from "./types";
import { CURRENCIES } from "./types";

export type ScenarioId =
  | "parallelUp"
  | "parallelDown"
  | "steepener"
  | "flattener"
  | "shortUp"
  | "shortDown";

export const SCENARIOS: readonly { id: ScenarioId; name: string }[] = [
  { id: "parallelUp", name: "Parallel up" },
  { id: "parallelDown", name: "Parallel down" },
  { id: "steepener", name: "Steepener" },
  { id: "flattener", name: "Flattener" },
  { id: "shortUp", name: "Short rates up" },
  { id: "shortDown", name: "Short rates down" },
];

/** Basel IRRBB curve coefficients. Short-rate decay is exp(−t / 4). */
export const STEEPENER_SHORT = -0.65;
export const STEEPENER_LONG = 0.9;
export const FLATTENER_SHORT = 0.8;
export const FLATTENER_LONG = -0.6;
export const SHORT_DECAY_YEARS = 4;

export interface Flow {
  currency: Currency;
  tYears: number;
  /** Asset principal positive, liability principal negative. */
  amount: number;
}

export function shockAt(
  spec: { parallel: number; short: number; long: number },
  scenario: ScenarioId,
  tYears: number,
): number {
  const shortWeight = Math.exp(-tYears / SHORT_DECAY_YEARS);
  const longWeight = 1 - shortWeight;
  const shortShock = spec.short * shortWeight;
  const longShock = spec.long * longWeight;

  switch (scenario) {
    case "parallelUp":
      return spec.parallel;
    case "parallelDown":
      return -spec.parallel;
    case "shortUp":
      return shortShock;
    case "shortDown":
      return -shortShock;
    case "steepener":
      return STEEPENER_SHORT * shortShock + STEEPENER_LONG * longShock;
    case "flattener":
      return FLATTENER_SHORT * shortShock + FLATTENER_LONG * longShock;
    default: {
      const exhaustive: never = scenario;
      return exhaustive;
    }
  }
}

export function presentValue(
  flows: Flow[],
  baseRate: number,
  shockAtT: (tYears: number) => number,
  floor: number,
): number {
  let value = 0;
  for (const flow of flows) {
    const rate = Math.max(floor, baseRate + shockAtT(flow.tYears));
    value += flow.amount * Math.exp(-rate * flow.tYears);
  }
  return value;
}

/** Twelve-month gap income. Positions at or beyond one year do not reprice inside the horizon. */
export function niiDelta(flows: Flow[], shockAtT: (tYears: number) => number): number {
  let income = 0;
  for (const flow of flows) {
    if (flow.tYears >= 1) continue;
    income += flow.amount * shockAtT(flow.tYears) * (1 - flow.tYears);
  }
  return income;
}

/** Losses count in full. Gains count at half. Returns a non-negative loss. */
export function countLoss(deltas: number[]): number {
  let aggregated = 0;
  for (const delta of deltas) {
    aggregated += delta < 0 ? delta : delta * 0.5;
  }
  return aggregated < 0 ? -aggregated : 0;
}

export interface GapRow {
  name: string;
  assets: number;
  liabilities: number;
  gap: number;
}

const GAP_BUCKETS: { name: string; min: number; max: number }[] = [
  { name: "Under 6 months", min: 0, max: 0.5 },
  { name: "6 to 12 months", min: 0.5, max: 1 },
  { name: "1 to 3 years", min: 1, max: 3 },
  { name: "3 to 5 years", min: 3, max: 5 },
  { name: "Over 5 years", min: 5, max: Number.POSITIVE_INFINITY },
];

export function gapRows(flows: Flow[]): GapRow[] {
  return GAP_BUCKETS.map((bucket) => {
    let assets = 0;
    let liabilities = 0;
    for (const flow of flows) {
      if (flow.tYears < bucket.min || flow.tYears >= bucket.max) continue;
      if (flow.amount >= 0) assets += flow.amount;
      else liabilities += -flow.amount;
    }
    return { name: bucket.name, assets, liabilities, gap: assets - liabilities };
  });
}

export function bankingBookFlows(book: Book): Flow[] {
  const flows: Flow[] = [];
  for (const line of book.lines) {
    if (!line.cashFlows || line.side === "equity") continue;
    const sign = line.side === "asset" ? 1 : -1;
    for (const slice of line.cashFlows) {
      flows.push({
        currency: line.currency,
        tYears: slice.tYears,
        amount: sign * line.amountGel * slice.fraction,
      });
    }
  }
  for (const loan of book.loans) {
    for (const slice of loan.cashFlows) {
      flows.push({
        currency: loan.currency,
        tYears: slice.tYears,
        amount: loan.eadGel * slice.fraction,
      });
    }
  }
  return flows;
}

export interface ScenarioResult {
  id: ScenarioId;
  name: string;
  byCurrency: Record<Currency, number>;
  loss: number;
  nii: number;
  shareOfTier1: number;
}

export interface IrrbbResult {
  scenarios: ScenarioResult[];
  gaps: GapRow[];
  worstId: ScenarioId;
  worstLoss: number;
  worstShare: number;
  tier1: number;
  limit: number;
}

export function runIrrbb(book: Book, tier1: number): IrrbbResult {
  const flows = bankingBookFlows(book);
  const scenarios = SCENARIOS.map((scenario) => {
    const byCurrency = { GEL: 0, USD: 0, EUR: 0 } as Record<Currency, number>;
    let nii = 0;
    for (const currency of CURRENCIES) {
      const currencyFlows = flows.filter((flow) => flow.currency === currency);
      const spec = book.shocks[currency];
      const base = presentValue(currencyFlows, book.referenceRates[currency], () => 0, book.policy.rateFloor);
      const shocked = presentValue(
        currencyFlows,
        book.referenceRates[currency],
        (tYears) => shockAt(spec, scenario.id, tYears),
        book.policy.rateFloor,
      );
      byCurrency[currency] = shocked - base;
      nii += niiDelta(currencyFlows, (tYears) => shockAt(spec, scenario.id, tYears));
    }
    const loss = countLoss(CURRENCIES.map((currency) => byCurrency[currency]));
    return {
      id: scenario.id,
      name: scenario.name,
      byCurrency,
      loss,
      nii,
      shareOfTier1: tier1 > 0 ? loss / tier1 : 0,
    };
  });

  const worst = scenarios.reduce((best, scenario) => (scenario.loss > best.loss ? scenario : best));

  return {
    scenarios,
    gaps: gapRows(flows),
    worstId: worst.id,
    worstLoss: worst.loss,
    worstShare: worst.shareOfTier1,
    tier1,
    limit: book.policy.eveLimit,
  };
}
