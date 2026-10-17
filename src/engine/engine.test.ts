import { describe, expect, it } from "vitest";
import { createSampleBook, sampleBook } from "./book";
import { capitalPosition } from "./capital";
import { assessLoan, expectedLoss, larization, lifetimePd, pdFromDsr } from "./credit";
import { measureFx } from "./fx";
import { countLoss, gapRows, niiDelta, presentValue, shockAt } from "./irrbb";
import { coverage, funding } from "./liquidity";
import { present } from "./present";
import { revalue } from "./revalue";
import { runBook } from "./run";
import type { Loan } from "./types";

describe("open currency position", () => {
  it("nets each currency, then takes the greater of longs and shorts", () => {
    const fx = measureFx({
      lines: [
        { side: "asset", currency: "USD", amountGel: 100 },
        { side: "liability", currency: "USD", amountGel: 80 },
        { side: "asset", currency: "EUR", amountGel: 40 },
        { side: "liability", currency: "EUR", amountGel: 70 },
        { side: "asset", currency: "GEL", amountGel: 999 },
      ],
      loans: [],
      forwards: [{ currency: "USD", buyGel: 10 }],
    });
    expect(fx.currencies.find((row) => row.currency === "USD")?.net).toBe(30);
    expect(fx.currencies.find((row) => row.currency === "EUR")?.net).toBe(-30);
    expect(fx.longs).toBe(30);
    expect(fx.shorts).toBe(30);
    expect(fx.overall).toBe(30);
    expect(fx.algebraicNet).toBe(0);
  });
});

describe("liquidity", () => {
  it("caps inflows at 75% of outflows and Level 2 at two-thirds of Level 1", () => {
    const row = coverage(
      [
        { amountGel: 40, hqla: { level: "L1", haircut: 0 } },
        { amountGel: 50, hqla: { level: "L2A", haircut: 0 } },
        { amountGel: 100, lcrOutflow: 1 },
        { amountGel: 90, lcrInflow: 1 },
      ],
      1,
    );
    expect(row.level2a).toBeCloseTo(80 / 3, 8);
    expect(row.hqla).toBeCloseTo(200 / 3, 8);
    expect(row.inflowsCounted).toBe(75);
    expect(row.netOutflow).toBe(25);
    expect(row.ratio).toBeCloseTo(8 / 3, 8);
  });

  it("applies the Level 2 cap to the portfolio it is given", () => {
    const first = coverage(
      [
        { amountGel: 30, hqla: { level: "L1", haircut: 0 } },
        { amountGel: 30, hqla: { level: "L2A", haircut: 0 } },
      ],
      1,
    );
    const second = coverage([{ amountGel: 30, hqla: { level: "L1", haircut: 0 } }], 1);
    const both = coverage(
      [
        { amountGel: 30, hqla: { level: "L1", haircut: 0 } },
        { amountGel: 30, hqla: { level: "L2A", haircut: 0 } },
        { amountGel: 30, hqla: { level: "L1", haircut: 0 } },
      ],
      1,
    );
    expect(first.hqla).toBeCloseTo(50, 8);
    expect(second.hqla).toBeCloseTo(30, 8);
    expect(both.hqla).toBeCloseTo(90, 8);
  });

  it("divides available stable funding by required stable funding", () => {
    const row = funding(
      [
        { amountGel: 100, asf: 1 },
        { amountGel: 50, asf: 0.5 },
        { amountGel: 80, rsf: 0.85 },
      ],
      1,
    );
    expect(row.available).toBe(125);
    expect(row.required).toBe(68);
    expect(row.ratio).toBeCloseTo(125 / 68, 8);
  });
});

describe("interest rate risk", () => {
  const spec = { parallel: 0.02, short: 0.03, long: 0.015 };

  it("builds the six Basel curve shocks", () => {
    expect(shockAt(spec, "parallelUp", 3)).toBe(0.02);
    expect(shockAt(spec, "parallelDown", 3)).toBe(-0.02);
    expect(shockAt(spec, "shortUp", 0)).toBeCloseTo(0.03, 8);
    expect(shockAt(spec, "steepener", 0)).toBeCloseTo(-0.65 * 0.03, 8);
    expect(shockAt(spec, "flattener", 0)).toBeCloseTo(0.8 * 0.03, 8);
    const shortWeight = Math.exp(-1);
    const longWeight = 1 - shortWeight;
    expect(shockAt(spec, "steepener", 4)).toBeCloseTo(-0.65 * 0.03 * shortWeight + 0.9 * 0.015 * longWeight, 8);
    expect(shockAt(spec, "flattener", 4)).toBeCloseTo(0.8 * 0.03 * shortWeight - 0.6 * 0.015 * longWeight, 8);
  });

  it("discounts a parallel shock with a floor at zero", () => {
    const flows = [{ currency: "GEL" as const, amount: 100, tYears: 1 }];
    const delta = presentValue(flows, 0.01, () => -0.05, 0) - presentValue(flows, 0.01, () => 0, 0);
    expect(delta).toBeCloseTo(100 - 100 * Math.exp(-0.01), 8);
    const unfloored = 100 * Math.exp(0.04) - 100 * Math.exp(-0.01);
    expect(delta).not.toBeCloseTo(unfloored, 4);
  });

  it("counts currency losses in full and gains at half", () => {
    expect(countLoss([-50, 20])).toBeCloseTo(40, 8);
    expect(countLoss([-10, -5])).toBeCloseTo(15, 8);
    expect(countLoss([10, 20])).toBe(0);
  });

  it("earns the gap only for the rest of the year", () => {
    const flows = [
      { currency: "GEL" as const, amount: 100, tYears: 0.25 },
      { currency: "GEL" as const, amount: -40, tYears: 0.25 },
    ];
    expect(niiDelta(flows, () => 0.02)).toBeCloseTo(0.9, 8);
  });

  it("slots principal into the gap ladder", () => {
    const rows = gapRows([
      { currency: "GEL", amount: 100, tYears: 0.25 },
      { currency: "GEL", amount: -40, tYears: 0.25 },
      { currency: "USD", amount: 10, tYears: 2 },
    ]);
    expect(rows[0]).toMatchObject({ assets: 100, liabilities: 40, gap: 60 });
    expect(rows[2]).toMatchObject({ assets: 10, liabilities: 0, gap: 10 });
  });
});

describe("expected credit loss", () => {
  const policy = sampleBook.policy;

  it("maps a low and a high debt-service ratio into the illustrative probabilities", () => {
    expect(pdFromDsr(0.3, policy)).toBeGreaterThan(0.008);
    expect(pdFromDsr(0.3, policy)).toBeLessThan(0.015);
    expect(pdFromDsr(0.6, policy)).toBeGreaterThan(0.06);
    expect(pdFromDsr(0.6, policy)).toBeLessThan(0.1);
  });

  it("discounts stage 1 for one year and stage 2 over the remaining life", () => {
    expect(expectedLoss(0.02, 0.4, 1000, 0.12, 5, 1)).toBeCloseTo(7.142857, 5);
    expect(expectedLoss(0.02, 0.4, 1000, 0.12, 2, 2)).toBeCloseTo(13.392857, 5);
    expect(expectedLoss(0.02, 0.4, 1000, 0.12, 5, 3)).toBeCloseTo(357.142857, 4);
    expect(lifetimePd(0.02, 1)).toBeCloseTo(0.02, 8);
  });

  it("applies the lari-loan ceiling only to a single foreign-currency facility", () => {
    const cap = 750_000;
    expect(larization({ currency: "USD", incomeCurrency: "GEL", facility: true, eadGel: 420_000 }, cap)).toBe("breach");
    expect(larization({ currency: "USD", incomeCurrency: "GEL", facility: true, eadGel: 750_000 }, cap)).toBe("breach");
    expect(larization({ currency: "USD", incomeCurrency: "GEL", facility: true, eadGel: 1_100_000 }, cap)).toBe("above-cap");
    expect(larization({ currency: "USD", incomeCurrency: "GEL", facility: false, eadGel: 100 }, cap)).toBe("not-applicable");
    expect(larization({ currency: "GEL", incomeCurrency: "GEL", facility: true, eadGel: 100 }, cap)).toBe("not-applicable");
    expect(larization({ currency: "USD", incomeCurrency: "USD", facility: true, eadGel: 100 }, cap)).toBe("not-applicable");
  });
});

describe("capital stack", () => {
  it("builds risk-weighted assets and stacks the buffers once", () => {
    const policy = sampleBook.policy;
    const result = capitalPosition({
      lines: [
        { side: "equity", amountGel: 100, capitalClass: "cet1" },
        { side: "equity", amountGel: 10, capitalClass: "at1" },
        { side: "liability", amountGel: 5, capitalClass: "tier2" },
        { side: "asset", amountGel: 50, riskWeight: 1 },
      ],
      loans: [
        { eadGel: 20, riskWeight: 0.5, currency: "USD", incomeCurrency: "GEL", hedged: false },
        { eadGel: 15, riskWeight: 1, currency: "USD", incomeCurrency: "USD", hedged: true },
      ],
      openPosition: 8,
      operationalRiskRwa: 10,
      policy,
    });
    const rwa = 60 + 8 + 10 + 15;
    const cicrCapital = 20 * policy.cicrExtraRiskWeight * policy.pillar1Total;
    const addOns = policy.conservation + policy.countercyclical + policy.systemic + policy.pillar2 + cicrCapital / rwa;
    expect(result.creditRwa).toBeCloseTo(60 + 15, 8);
    expect(result.marketRwa).toBeCloseTo(8, 8);
    expect(result.rwa).toBeCloseTo(rwa, 8);
    expect(result.unhedgedEad).toBe(20);
    expect(result.cicrCapital).toBeCloseTo(cicrCapital, 8);
    expect(result.cet1Amount).toBe(100);
    expect(result.tier1Amount).toBe(110);
    expect(result.totalAmount).toBe(115);
    expect(result.addOns).toBeCloseTo(addOns, 8);
    expect(result.minimumCet1).toBeCloseTo(policy.pillar1Cet1 + addOns, 8);
    expect(result.minimumTier1).toBeCloseTo(policy.pillar1Tier1 + addOns, 8);
    expect(result.minimumTotal).toBeCloseTo(policy.pillar1Total + addOns, 8);
  });
});

describe("Alazani book", () => {
  const reported = runBook(sampleBook);

  it("ties the balance sheet and keeps every repricing schedule whole", () => {
    expect(Math.abs(reported.balance.gap)).toBeLessThan(1);
    for (const line of sampleBook.lines) {
      if (!line.cashFlows) continue;
      const sum = line.cashFlows.reduce((total, slice) => total + slice.fraction, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
    for (const loan of sampleBook.loans) {
      const sum = loan.cashFlows.reduce((total, slice) => total + slice.fraction, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("holds a short dollar book inside the 20% ceiling, with the forward included", () => {
    expect(reported.fx.overall).toBe(108_480_000);
    expect(reported.fx.regulatoryCapital).toBe(595_000_000);
    expect(reported.fx.ratio).toBeCloseTo(108_480_000 / 595_000_000, 8);
    expect(reported.fx.currencies.find((row) => row.currency === "USD")?.net).toBe(-108_480_000);
    expect(reported.fx.currencies.find((row) => row.currency === "EUR")?.net).toBe(25_000_000);
  });

  it("fails dollar coverage while the all-currency ratio and stable funding pass", () => {
    expect(reported.lcr.USD.ratio).toBeLessThan(sampleBook.policy.lcrFloorFx);
    expect(reported.lcr.all.ratio).toBeGreaterThan(sampleBook.policy.lcrFloorAll);
    expect(reported.lcr.GEL.ratio).toBeGreaterThan(sampleBook.policy.lcrFloorGel);
    expect(reported.nsfr.all.ratio).toBeGreaterThan(sampleBook.policy.nsfrFloor);
  });

  it("keeps the rate loss inside 15% of tier 1 and off the floor", () => {
    expect(reported.irrbb.worstShare).toBeGreaterThan(0.02);
    expect(reported.irrbb.worstShare).toBeLessThan(sampleBook.policy.eveLimit);
  });

  it("flags the auto loan and leaves the exporter's probability unchanged in a revaluation", () => {
    expect(reported.credit.loans.find((loan) => loan.id === "usd-auto")?.larization).toBe("breach");
    expect(reported.credit.loans.find((loan) => loan.id === "usd-retail")?.stage).toBe(1);
    const shockedBook = revalue(sampleBook, 0.2);
    const shocked = runBook(shockedBook);
    const exporter = shocked.credit.loans.find((loan) => loan.id === "usd-exporters");
    const retail = shocked.credit.loans.find((loan) => loan.id === "usd-retail");
    expect(exporter?.pd12).toBeCloseTo(reported.credit.loans.find((loan) => loan.id === "usd-exporters")!.pd12, 8);
    expect(retail?.stage).toBe(2);
    expect(retail?.lgd).toBeCloseTo(0.4 + 0.75 * 0.2, 8);
    expect(shocked.credit.totalEcl).toBeGreaterThan(reported.credit.totalEcl);
    expect(shocked.capital.cet1Amount).toBeLessThan(reported.capital.cet1Amount);
    expect(shocked.fx.ratio).toBeGreaterThan(sampleBook.policy.fxLimit);
    expect(Math.abs(shocked.balance.gap)).toBeLessThan(1);
  });

  it("does not mutate the reported book", () => {
    const before = sampleBook.lines.find((line) => line.id === "cet1")!.amountGel;
    revalue(sampleBook, 0.2);
    expect(sampleBook.lines.find((line) => line.id === "cet1")!.amountGel).toBe(before);
    expect(sampleBook.depreciation).toBe(0);
    expect(createSampleBook().depreciation).toBe(0);
  });

  it("tells the committee that position is tight and dollar liquidity is in breach", () => {
    const view = present(reported, reported);
    expect(view.limits.find((limit) => limit.id === "fx")?.status).toBe("tight");
    expect(view.limits.find((limit) => limit.id === "liquidity")?.status).toBe("breach");
    expect(view.limits.find((limit) => limit.id === "eve")?.status).not.toBe("breach");
    expect(view.limits.find((limit) => limit.id === "capital")?.status).not.toBe("breach");
    expect(view.story).toBe("");

    const shocked = runBook(revalue(sampleBook, 0.2));
    const moved = present(reported, shocked);
    expect(moved.limits.find((limit) => limit.id === "fx")?.status).toBe("breach");
    expect(moved.extraEcl).toBeGreaterThan(0);
    expect(moved.proFormaCet1).toBeLessThan(shocked.capital.cet1Amount);
    expect(moved.story).toContain("breach");
  });
});

describe("stage migration on a single loan", () => {
  it("moves the dollar retail profile into stage 2 when debt service is scaled by 20%", () => {
    const base = sampleBook.loans.find((loan) => loan.id === "usd-retail") as Loan;
    expect(assessLoan(base, sampleBook.policy, 0).stage).toBe(1);
    const stressed = { ...base, dsrCurrent: base.dsrCurrent * 1.2 };
    expect(assessLoan(stressed, sampleBook.policy, 0.2).stage).toBe(2);
  });
});
