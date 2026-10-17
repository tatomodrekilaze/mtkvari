import type { Currency, Loan, Policy } from "./types";

export type Stage = 1 | 2 | 3;
export type Larization = "breach" | "above-cap" | "not-applicable";

export function pdFromDsr(dsr: number, policy: Pick<Policy, "pdIntercept" | "pdSlope">): number {
  const logit = policy.pdIntercept + policy.pdSlope * dsr;
  const pd = 1 / (1 + Math.exp(-logit));
  return Math.min(0.999, Math.max(0, pd));
}

export function lifetimePd(pdAnnual: number, years: number): number {
  return 1 - (1 - pdAnnual) ** years;
}

export function isUnhedgedFx(loan: {
  currency: Currency;
  incomeCurrency: Currency;
  hedged: boolean;
}): boolean {
  return loan.currency !== "GEL" && loan.currency !== loan.incomeCurrency && !loan.hedged;
}

/**
 * Loans up to the cap, to a borrower paid in lari, have to be denominated in lari.
 * Portfolio rows are not facilities, so the rule is not applied to them.
 */
export function larization(loan: Pick<Loan, "currency" | "incomeCurrency" | "facility" | "eadGel">, capGel: number): Larization {
  if (!loan.facility || loan.currency === "GEL" || loan.incomeCurrency !== "GEL") return "not-applicable";
  return loan.eadGel <= capGel ? "breach" : "above-cap";
}

export function expectedLoss(
  pdAnnual: number,
  lgd: number,
  ead: number,
  eir: number,
  years: number,
  stage: Stage,
): number {
  const horizon = stage === 2 ? years : 1;
  const probability = stage === 3 ? 1 : pdAnnual;
  let survival = 1;
  let loss = 0;
  for (let year = 1; year <= horizon; year += 1) {
    const marginal = survival * probability;
    survival -= marginal;
    loss += (marginal * lgd * ead) / (1 + eir) ** year;
  }
  return loss;
}

export interface LoanAssessment {
  id: string;
  name: string;
  currency: Currency;
  incomeCurrency: Currency;
  hedged: boolean;
  facility: boolean;
  eadGel: number;
  dsr: number;
  pd12: number;
  lifetimePd: number;
  lgd: number;
  stage: Stage;
  ecl: number;
  larization: Larization;
  daysPastDue: number;
}

export function remainingYears(maturityYears: number): number {
  return Math.max(1, Math.round(maturityYears));
}

export function assessLoan(loan: Loan, policy: Policy, depreciation: number): LoanAssessment {
  const years = remainingYears(loan.maturityYears);
  const pd12 = pdFromDsr(loan.dsrCurrent, policy);
  const pdOrigination = pdFromDsr(loan.dsrOrigination, policy);
  const life = lifetimePd(pd12, years);
  const lifeAtOrigination = lifetimePd(pdOrigination, years);

  let stage: Stage = 1;
  if (loan.daysPastDue >= 90) stage = 3;
  else if (loan.daysPastDue >= 30 || (life > 2 * lifeAtOrigination && life - lifeAtOrigination >= 0.005)) stage = 2;

  let lgd = loan.lgd;
  if (isUnhedgedFx(loan) && depreciation > 0) {
    lgd = Math.min(0.95, loan.lgd + policy.lgdUpliftPerDepreciation * depreciation);
  }

  return {
    id: loan.id,
    name: loan.name,
    currency: loan.currency,
    incomeCurrency: loan.incomeCurrency,
    hedged: loan.hedged,
    facility: loan.facility,
    eadGel: loan.eadGel,
    dsr: loan.dsrCurrent,
    pd12,
    lifetimePd: life,
    lgd,
    stage,
    ecl: expectedLoss(pd12, lgd, loan.eadGel, loan.eir, years, stage),
    larization: larization(loan, policy.larizationCapGel),
    daysPastDue: loan.daysPastDue,
  };
}

export interface CreditResult {
  loans: LoanAssessment[];
  totalEcl: number;
  byStage: Record<Stage, { count: number; ead: number; ecl: number }>;
}

export function assessBook(loans: Loan[], policy: Policy, depreciation: number): CreditResult {
  const assessed = loans.map((loan) => assessLoan(loan, policy, depreciation));
  const byStage: CreditResult["byStage"] = {
    1: { count: 0, ead: 0, ecl: 0 },
    2: { count: 0, ead: 0, ecl: 0 },
    3: { count: 0, ead: 0, ecl: 0 },
  };
  let totalEcl = 0;
  for (const loan of assessed) {
    totalEcl += loan.ecl;
    const bucket = byStage[loan.stage];
    bucket.count += 1;
    bucket.ead += loan.eadGel;
    bucket.ecl += loan.ecl;
  }
  return { loans: assessed, totalEcl, byStage };
}
