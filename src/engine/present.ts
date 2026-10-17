import { mln, pct, signedMln } from "./format";
import type { Coverage } from "./liquidity";
import type { AlcoResult } from "./run";
import type { Book } from "./types";

export type Status = "pass" | "tight" | "breach";

export function statusFromUtilization(utilization: number): Status {
  if (!Number.isFinite(utilization) || utilization > 1 + 1e-6) return "breach";
  if (utilization >= 0.85) return "tight";
  return "pass";
}

export interface LimitCard {
  id: string;
  name: string;
  status: Status;
  utilization: number;
  value: string;
  detail: string;
}

export interface Presentation {
  limits: LimitCard[];
  story: string;
  position: string;
  liquidity: string;
  rates: string;
  credit: string;
  capital: string;
  proFormaCet1: number;
  extraEcl: number;
}

function floorUse(ratio: number, floor: number): number {
  if (!Number.isFinite(ratio)) return 0;
  if (ratio <= 0) return Number.POSITIVE_INFINITY;
  return floor / ratio;
}

function clause(name: string, status: Status): string {
  if (status === "pass") return `${name} passes`;
  if (status === "tight") return `${name} is tight`;
  return `${name} is in breach`;
}

function proForma(reported: AlcoResult, current: AlcoResult): { extraEcl: number; equity: number; ratio: number } {
  const extraEcl = Math.max(0, current.credit.totalEcl - reported.credit.totalEcl);
  const equity = current.capital.cet1Amount - extraEcl;
  const ratio = current.capital.rwa > 0 ? equity / current.capital.rwa : 0;
  return { extraEcl, equity, ratio };
}

function cards(current: AlcoResult, equityRatio: number, afterExtraLoss: boolean): LimitCard[] {
  const candidates: { name: string; ratio: number; floor: number }[] = [
    { name: "All-currency coverage", ratio: current.lcr.all.ratio, floor: current.lcr.all.floor },
    { name: "Lari coverage", ratio: current.lcr.GEL.ratio, floor: current.lcr.GEL.floor },
    { name: "Dollar coverage", ratio: current.lcr.USD.ratio, floor: current.lcr.USD.floor },
    { name: "Euro coverage", ratio: current.lcr.EUR.ratio, floor: current.lcr.EUR.floor },
    { name: "Stable funding", ratio: current.nsfr.all.ratio, floor: current.nsfr.all.floor },
  ];
  const binding = candidates.reduce((tightest, candidate) =>
    floorUse(candidate.ratio, candidate.floor) > floorUse(tightest.ratio, tightest.floor) ? candidate : tightest,
  );

  const fxUse = current.fx.limitRatio > 0 ? current.fx.ratio / current.fx.limitRatio : Number.POSITIVE_INFINITY;
  const eveUse = current.irrbb.limit > 0 ? current.irrbb.worstShare / current.irrbb.limit : Number.POSITIVE_INFINITY;
  const capitalUse = equityRatio > 0 ? current.capital.minimumCet1 / equityRatio : Number.POSITIVE_INFINITY;

  return [
    {
      id: "fx",
      name: "Open position",
      status: statusFromUtilization(fxUse),
      utilization: fxUse,
      value: pct(current.fx.ratio),
      detail: `Ceiling ${pct(current.fx.limitRatio, 0)}`,
    },
    {
      id: "liquidity",
      name: binding.name,
      status: statusFromUtilization(floorUse(binding.ratio, binding.floor)),
      utilization: floorUse(binding.ratio, binding.floor),
      value: pct(binding.ratio),
      detail: `Floor ${pct(binding.floor, 0)}`,
    },
    {
      id: "eve",
      name: "Economic value",
      status: statusFromUtilization(eveUse),
      utilization: eveUse,
      value: pct(current.irrbb.worstShare),
      detail: `Ceiling ${pct(current.irrbb.limit, 0)} of tier 1`,
    },
    {
      id: "capital",
      name: "Common equity",
      status: statusFromUtilization(capitalUse),
      utilization: capitalUse,
      value: pct(equityRatio, 2),
      detail: afterExtraLoss
        ? `After extra loss. Minimum ${pct(current.capital.minimumCet1, 2)}`
        : `Minimum ${pct(current.capital.minimumCet1, 2)}`,
    },
  ];
}

function lcrRow(current: AlcoResult, name: string): Coverage {
  if (name === "Lari coverage") return current.lcr.GEL;
  if (name === "Dollar coverage") return current.lcr.USD;
  if (name === "Euro coverage") return current.lcr.EUR;
  return current.lcr.all;
}

export function depositNote(book: Book): string {
  const line = book.lines.find((item) => item.id === "demand-hh-gel");
  if (!line?.cashFlows) return "";
  const parts = line.cashFlows.map((slice) => {
    const where = slice.tYears < 0.1 ? "overnight" : `at ${slice.tYears} years`;
    return `${pct(slice.fraction, 0)} ${where}`;
  });
  return `Household lari demand is placed ${parts.join(" and ")}. The other demand lines use the same split.`;
}

export function present(reported: AlcoResult, current: AlcoResult): Presentation {
  const forma = proForma(reported, current);
  const limits = cards(current, forma.ratio, forma.extraEcl > 0);
  const worst = current.irrbb.scenarios.find((scenario) => scenario.id === current.irrbb.worstId) ?? current.irrbb.scenarios[0];

  const headroom =
    current.fx.headroom >= 0
      ? `Headroom is ${mln(current.fx.headroom)} million.`
      : `The position is over the ceiling by ${mln(-current.fx.headroom)} million.`;

  const position = `Long positions add to ${mln(current.fx.longs)} million and short positions add to ${mln(current.fx.shorts)} million. The overall open position is the larger of those, ${mln(current.fx.overall)} million. The ceiling is ${pct(current.fx.limitRatio, 0)} of regulatory capital, ${pct(current.fx.limitRatio, 0)} × ${mln(current.fx.regulatoryCapital)} million = ${mln(current.fx.limitAmount)} million. ${headroom}`;

  const focus = limits.find((limit) => limit.id === "liquidity");
  const focusRow = lcrRow(current, focus?.name ?? "All-currency coverage");
  const liquidityLead =
    focus?.name === "Stable funding"
      ? "Stable funding is the tightest liquidity measure on this book."
      : `${focus?.name ?? "Coverage"} is ${mln(focusRow.hqla)} million of high-quality assets over a net outflow of ${mln(focusRow.netOutflow)} million, so the ratio is ${pct(focusRow.ratio)} against a floor of ${pct(focusRow.floor, 0)}.`;
  const liquidity = `${liquidityLead} Stable funding is ${mln(current.nsfr.all.available)} million over ${mln(current.nsfr.all.required)} million, a ratio of ${pct(current.nsfr.all.ratio)} against a floor of ${pct(current.nsfr.all.floor, 0)}.`;

  const rates = `The largest loss of economic value is ${mln(worst.loss)} million in the ${worst.name.toLowerCase()} scenario. Tier 1 is ${mln(current.irrbb.tier1)} million, and ${pct(current.irrbb.limit, 0)} of that is ${mln(current.irrbb.limit * current.irrbb.tier1)} million. The loss is ${pct(worst.shareOfTier1)} of tier 1. On the same shift, twelve-month net interest income changes by ${signedMln(worst.nii)} million.`;

  const moved = current.credit.loans.filter((loan) => {
    const prior = reported.credit.loans.find((item) => item.id === loan.id);
    return prior !== undefined && loan.stage > prior.stage;
  }).length;
  const breaches = current.credit.loans.filter((loan) => loan.larization === "breach").length;
  const migration =
    current.depreciation === 0
      ? ""
      : moved === 0
        ? " No row changes stage."
        : ` ${moved} ${moved === 1 ? "row moves" : "rows move"} to a later stage.`;
  const breachText = breaches === 1 ? "One facility sits" : `${breaches} facilities sit`;
  const credit = `Expected loss on the tape is ${mln(current.credit.totalEcl, 2)} million. Stage 1 is ${mln(current.credit.byStage[1].ecl, 2)} million, stage 2 is ${mln(current.credit.byStage[2].ecl, 2)} million, and stage 3 is ${mln(current.credit.byStage[3].ecl, 2)} million. ${breachText} under the lari-loan ceiling.${migration}`;

  const bridge =
    forma.extraEcl > 0
      ? ` Taking the extra expected loss of ${mln(forma.extraEcl, 2)} million would leave ${mln(forma.equity)} million, a ratio of ${pct(forma.ratio, 2)}.`
      : ` The common-equity ratio is ${pct(current.capital.cet1Ratio, 2)}.`;
  const capital = `Translated common equity is ${mln(current.capital.cet1Amount)} million.${bridge} Unhedged foreign-currency exposure is ${mln(current.capital.unhedgedEad)} million. The currency add-on is ${mln(current.capital.cicrCapital)} million, which is ${pct(current.capital.cicrRatio, 2)} of risk-weighted assets. The common-equity minimum is ${pct(current.capital.minimumCet1, 2)}.`;

  let story = "";
  if (current.depreciation > 0) {
    const baseline = cards(reported, proForma(reported, reported).ratio, false);
    const changed = limits
      .filter((limit, index) => limit.status !== baseline[index]?.status)
      .map((limit) => clause(limit.name, limit.status));
    const equityMove = current.capital.cet1Amount - reported.capital.cet1Amount;
    const lossMove = current.credit.totalEcl - reported.credit.totalEcl;
    const changeText = changed.length > 0 ? ` ${changed.join(". ")}.` : "";
    story = `After a ${pct(current.depreciation, 0)} fall in the lari, translated equity changes by ${signedMln(equityMove)} million and expected loss changes by ${signedMln(lossMove)} million.${changeText}`;
  }

  return {
    limits,
    story,
    position,
    liquidity,
    rates,
    credit,
    capital,
    proFormaCet1: forma.equity,
    extraEcl: forma.extraEcl,
  };
}
