import { capitalPosition, type CapitalResult } from "./capital";
import { assessBook, type CreditResult } from "./credit";
import { measureFx, type FxMeasure } from "./fx";
import { runIrrbb, type IrrbbResult } from "./irrbb";
import { balanceSheet, type Balance } from "./ledger";
import { coverage, funding, type Coverage, type FactorPiece, type Funding } from "./liquidity";
import type { Book, Currency } from "./types";

export interface FxResult extends FxMeasure {
  regulatoryCapital: number;
  limitAmount: number;
  limitRatio: number;
  ratio: number;
  headroom: number;
}

export interface AlcoResult {
  depreciation: number;
  balance: Balance;
  fx: FxResult;
  lcr: Record<Currency | "all", Coverage>;
  nsfr: Record<Currency | "all", Funding>;
  irrbb: IrrbbResult;
  credit: CreditResult;
  capital: CapitalResult;
}

function pieces(book: Book, currency?: Currency): FactorPiece[] {
  const rows: FactorPiece[] = [];
  for (const line of book.lines) {
    if (currency && line.currency !== currency) continue;
    rows.push(line);
  }
  for (const loan of book.loans) {
    if (currency && loan.currency !== currency) continue;
    rows.push({
      amountGel: loan.eadGel,
      lcrInflow: loan.lcrInflow,
      rsf: loan.rsf,
    });
  }
  return rows;
}

export function runBook(book: Book): AlcoResult {
  const fxMeasure = measureFx(book);
  const credit = assessBook(book.loans, book.policy, book.depreciation);
  const capital = capitalPosition({
    lines: book.lines,
    loans: book.loans,
    openPosition: fxMeasure.overall,
    operationalRiskRwa: book.operationalRiskRwa,
    policy: book.policy,
  });

  const regulatoryCapital = capital.totalAmount;
  const limitAmount = book.policy.fxLimit * regulatoryCapital;

  return {
    depreciation: book.depreciation,
    balance: balanceSheet(book),
    fx: {
      ...fxMeasure,
      regulatoryCapital,
      limitAmount,
      limitRatio: book.policy.fxLimit,
      ratio: regulatoryCapital > 0 ? fxMeasure.overall / regulatoryCapital : 0,
      headroom: limitAmount - fxMeasure.overall,
    },
    lcr: {
      all: coverage(pieces(book), book.policy.lcrFloorAll),
      GEL: coverage(pieces(book, "GEL"), book.policy.lcrFloorGel),
      USD: coverage(pieces(book, "USD"), book.policy.lcrFloorFx),
      EUR: coverage(pieces(book, "EUR"), book.policy.lcrFloorFx),
    },
    nsfr: {
      all: funding(pieces(book), book.policy.nsfrFloor),
      GEL: funding(pieces(book, "GEL"), book.policy.nsfrFloor),
      USD: funding(pieces(book, "USD"), book.policy.nsfrFloor),
      EUR: funding(pieces(book, "EUR"), book.policy.nsfrFloor),
    },
    irrbb: runIrrbb(book, capital.tier1Amount),
    credit,
    capital,
  };
}
