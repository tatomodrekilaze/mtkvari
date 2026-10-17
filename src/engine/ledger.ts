import type { Book, Currency, Line } from "./types";

export interface Balance {
  assets: number;
  liabilities: number;
  equity: number;
  gap: number;
}

export function balanceSheet(book: Book): Balance {
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  for (const loan of book.loans) assets += loan.eadGel;
  for (const line of book.lines) {
    if (line.side === "asset") assets += line.amountGel;
    else if (line.side === "liability") liabilities += line.amountGel;
    else equity += line.amountGel;
  }
  return { assets, liabilities, equity, gap: assets - liabilities - equity };
}

export interface StatementRow {
  id: string;
  name: string;
  side: Line["side"];
  currency: Currency;
  amountGel: number;
  hqla: string;
  thirtyDay: string;
  stableFunding: string;
  riskWeight: number | null;
}

function percentLabel(rate: number): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(rate * 100)}%`;
}

function fromLine(line: Line): StatementRow {
  let hqla = "";
  if (line.hqla) {
    hqla = line.hqla.haircut === 0 ? "Level 1" : `Level 2A, ${percentLabel(line.hqla.haircut)} haircut`;
  }
  let thirtyDay = "";
  if (line.lcrOutflow) thirtyDay = `Outflow ${percentLabel(line.lcrOutflow)}`;
  if (line.lcrInflow) thirtyDay = `Inflow ${percentLabel(line.lcrInflow)}`;
  let stableFunding = "";
  if (line.asf !== undefined && line.side !== "asset") stableFunding = `Available ${percentLabel(line.asf)}`;
  if (line.rsf !== undefined && line.side === "asset") stableFunding = `Required ${percentLabel(line.rsf)}`;
  return {
    id: line.id,
    name: line.name,
    side: line.side,
    currency: line.currency,
    amountGel: line.amountGel,
    hqla,
    thirtyDay,
    stableFunding,
    riskWeight: line.side === "asset" ? (line.riskWeight ?? 0) : null,
  };
}

export function statement(book: Book): StatementRow[] {
  const assets = book.lines.filter((line) => line.side === "asset").map(fromLine);
  const loanRows: StatementRow[] = book.loans.map((loan) => ({
    id: loan.id,
    name: loan.name,
    side: "asset",
    currency: loan.currency,
    amountGel: loan.eadGel,
    hqla: "",
    thirtyDay: loan.lcrInflow ? `Inflow ${percentLabel(loan.lcrInflow)}` : "",
    stableFunding: `Required ${percentLabel(loan.rsf)}`,
    riskWeight: loan.riskWeight,
  }));
  const liabilities = book.lines.filter((line) => line.side === "liability").map(fromLine);
  const equity = book.lines.filter((line) => line.side === "equity").map(fromLine);
  return [...assets, ...loanRows, ...liabilities, ...equity];
}
