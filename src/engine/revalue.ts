import { measureFx } from "./fx";
import type { Book, Line } from "./types";

/**
 * A lari depreciation scales every foreign-currency amount.
 * Equity takes the algebraic gain or loss, including forwards.
 * The forward's new mark is booked as its own lari asset or liability so the sheet still ties:
 * change in assets = change in liabilities + change in equity.
 */
export function revalue(book: Book, depreciation: number): Book {
  if (depreciation === 0) return book;

  const measured = measureFx(book);
  const scale = 1 + depreciation;
  const translation = measured.algebraicNet * depreciation;
  const forwardNotional = book.forwards.reduce((sum, forward) => sum + forward.buyGel, 0);
  const forwardMtm = forwardNotional * depreciation;

  const cet1Count = book.lines.filter((line) => line.capitalClass === "cet1").length;
  if (cet1Count !== 1) throw new Error("Book needs exactly one common-equity line.");

  const lines: Line[] = book.lines.map((line) => {
    if (line.capitalClass === "cet1") return { ...line, amountGel: line.amountGel + translation };
    if (line.currency === "GEL") return { ...line };
    return { ...line, amountGel: line.amountGel * scale };
  });

  if (forwardMtm !== 0) {
    const gain = forwardMtm > 0;
    lines.push({
      id: "fx-forward-mtm",
      name: "Mark-to-market on FX forwards",
      side: gain ? "asset" : "liability",
      currency: "GEL",
      amountGel: Math.abs(forwardMtm),
      riskWeight: gain ? 0.2 : undefined,
      rsf: gain ? 0 : undefined,
      asf: gain ? undefined : 0,
    });
  }

  const loans = book.loans.map((loan) => {
    const foreign = loan.currency !== "GEL";
    const reprice = foreign && loan.currency !== loan.incomeCurrency && !loan.hedged;
    return {
      ...loan,
      eadGel: foreign ? loan.eadGel * scale : loan.eadGel,
      dsrCurrent: reprice ? loan.dsrCurrent * scale : loan.dsrCurrent,
    };
  });

  const forwards = book.forwards.map((forward) => ({ ...forward, buyGel: forward.buyGel * scale }));

  return { ...book, depreciation, lines, loans, forwards };
}
