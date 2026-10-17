import type { Currency, Forward, Line, Loan } from "./types";

export interface CurrencyPosition {
  currency: Exclude<Currency, "GEL">;
  assets: number;
  liabilities: number;
  forwards: number;
  net: number;
}

export interface FxMeasure {
  currencies: CurrencyPosition[];
  longs: number;
  shorts: number;
  overall: number;
  algebraicNet: number;
}

export interface FxInput {
  lines: Pick<Line, "side" | "currency" | "amountGel">[];
  loans: Pick<Loan, "currency" | "eadGel">[];
  forwards: Pick<Forward, "currency" | "buyGel">[];
}

interface Bucket {
  assets: number;
  liabilities: number;
  forwards: number;
}

/**
 * Overall open position is the greater of foreign-currency longs and shorts.
 * GEL is the reporting currency and is not an open position.
 */
export function measureFx(input: FxInput): FxMeasure {
  const buckets = new Map<Exclude<Currency, "GEL">, Bucket>();

  const bucket = (currency: Currency): Bucket | null => {
    if (currency === "GEL") return null;
    let row = buckets.get(currency);
    if (!row) {
      row = { assets: 0, liabilities: 0, forwards: 0 };
      buckets.set(currency, row);
    }
    return row;
  };

  for (const line of input.lines) {
    const row = bucket(line.currency);
    if (!row) continue;
    if (line.side === "asset") row.assets += line.amountGel;
    if (line.side === "liability") row.liabilities += line.amountGel;
  }

  for (const loan of input.loans) {
    const row = bucket(loan.currency);
    if (!row) continue;
    row.assets += loan.eadGel;
  }

  for (const forward of input.forwards) {
    const row = bucket(forward.currency);
    if (!row) continue;
    row.forwards += forward.buyGel;
  }

  const order: Exclude<Currency, "GEL">[] = ["USD", "EUR"];
  for (const currency of buckets.keys()) {
    if (!order.includes(currency)) order.push(currency);
  }

  const currencies: CurrencyPosition[] = [];
  let longs = 0;
  let shorts = 0;
  let algebraicNet = 0;

  for (const currency of order) {
    const row = buckets.get(currency);
    if (!row) continue;
    const net = row.assets - row.liabilities + row.forwards;
    if (net > 0) longs += net;
    if (net < 0) shorts += -net;
    algebraicNet += net;
    currencies.push({ currency, ...row, net });
  }

  return {
    currencies,
    longs,
    shorts,
    overall: Math.max(longs, shorts),
    algebraicNet,
  };
}
