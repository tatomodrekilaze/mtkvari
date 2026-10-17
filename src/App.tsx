import { Fragment, useEffect, useMemo, useState } from "react";
import { footnotes, sampleBook } from "./engine/book";
import type { LoanAssessment, Larization } from "./engine/credit";
import { bp, mln, pct, points, lari, signedMln } from "./engine/format";
import { statement } from "./engine/ledger";
import { depositNote, present } from "./engine/present";
import { revalue } from "./engine/revalue";
import { runBook, type AlcoResult } from "./engine/run";
import type { Currency } from "./engine/types";

const CURRENCY_NAME: Record<Currency, string> = {
  GEL: "GEL",
  USD: "USD",
  EUR: "EUR",
};

function direction(net: number): string {
  if (net > 0) return "Long";
  if (net < 0) return "Short";
  return "Flat";
}

function ruleLabel(mark: Larization): string {
  if (mark === "breach") return "Breach";
  if (mark === "above-cap") return "Above cap";
  return "—";
}

function owes(loan: LoanAssessment): string {
  return `${loan.currency} / ${loan.incomeCurrency}`;
}

function hedgeLabel(loan: LoanAssessment): string {
  if (loan.currency === loan.incomeCurrency) return "—";
  return loan.hedged ? "Hedged" : "Unhedged";
}

type DeskId = "position" | "liquidity" | "rates" | "credit" | "capital" | "ledger" | "sources";

const DESKS: { id: DeskId; label: string; key: string }[] = [
  { id: "position", label: "Position", key: "1" },
  { id: "liquidity", label: "Liquidity", key: "2" },
  { id: "rates", label: "Rates", key: "3" },
  { id: "credit", label: "Credit", key: "4" },
  { id: "capital", label: "Capital", key: "5" },
  { id: "ledger", label: "Ledger", key: "6" },
  { id: "sources", label: "Sources", key: "7" },
];

const LIMIT_DESK: Record<string, DeskId> = {
  fx: "position",
  liquidity: "liquidity",
  eve: "rates",
  capital: "capital",
};

function stateWord(status: string): string {
  if (status === "breach") return "Breach";
  if (status === "tight") return "Tight";
  return "Pass";
}

export function App() {
  const [dep, setDep] = useState(0);
  const [desk, setDesk] = useState<DeskId>("position");
  const reported = useMemo(() => runBook(sampleBook), []);
  const currentBook = useMemo(() => revalue(sampleBook, dep / 100), [dep]);
  const current = useMemo(() => (dep === 0 ? reported : runBook(currentBook)), [currentBook, dep, reported]);
  const view = useMemo(() => present(reported, current), [reported, current]);
  const policy = sampleBook.policy;
  const breaches = view.limits.filter((limit) => limit.status === "breach");
  const sheetTies = Math.abs(current.balance.gap) < 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const next = DESKS.find((item) => item.key === event.key);
      if (!next) return;
      event.preventDefault();
      setDesk(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <header className="nameplate">
        <h1>მტკვარი</h1>
        <p>ALCO desk</p>
        <p className="bank">{sampleBook.meta.bank}. Illustrative book, not a supervisory return.</p>
        <p>{sampleBook.meta.asOf}</p>
        <p>Refinancing {pct(sampleBook.referenceRates.GEL, 2)}</p>
      </header>

      <div className="board" role="group" aria-label="Limits">
        {view.limits.map((limit) => (
          <button
            className="limit"
            data-status={limit.status}
            type="button"
            key={limit.id}
            aria-current={desk === LIMIT_DESK[limit.id] ? "page" : undefined}
            onClick={() => setDesk(LIMIT_DESK[limit.id])}
          >
            <span className="limit-name">
              <span>{limit.name}</span>
              <span className="limit-state">{stateWord(limit.status)}</span>
            </span>
            <span className="track" aria-hidden="true">
              <span className="fill" style={{ width: `${Math.min(limit.utilization, 1) * 100}%` }} />
            </span>
            <span className="limit-value">{limit.value}</span>
            <span className="limit-detail">{limit.detail}</span>
          </button>
        ))}
      </div>

      <div className="command">
        <nav className="desks" aria-label="Desks">
          {DESKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={desk === item.id ? "page" : undefined}
              onClick={() => setDesk(item.id)}
            >
              <span className="key">{item.key}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="scenario">
          <div className="lever">
          <label htmlFor="lari">
            <span>Lari depreciation</span>
            <span className="shock-now">{dep}%</span>
          </label>
          <input
            id="lari"
            type="range"
            min={0}
            max={30}
            step={1}
            value={dep}
            aria-describedby="shock-help"
            onChange={(event) => setDep(Number(event.target.value))}
          />
          <span className="ticks" aria-hidden="true">
            <span>0</span>
            <span>10</span>
            <span>20</span>
            <span>30</span>
          </span>
          </div>
          <button className="reset" type="button" onClick={() => setDep(0)} disabled={dep === 0}>
            Reported book
          </button>
        </div>
      </div>
      <p className="shock-help" id="shock-help" aria-live="polite">
        Revalues every dollar and euro amount, and rebuilds expected loss where the borrower earns lari and owes foreign currency.
        {view.story ? ` ${view.story}` : ""}
      </p>

      <main className="work">
        {desk === "position" ? (
          <Position result={current} text={view.position} forwards={currentBook.forwards} limit={policy.fxLimit} />
        ) : null}
        {desk === "liquidity" ? <Liquidity result={current} text={view.liquidity} /> : null}
        {desk === "rates" ? <Rates result={current} text={view.rates} /> : null}
        {desk === "credit" ? <Credit result={current} text={view.credit} /> : null}
        {desk === "capital" ? (
          <Capital result={current} text={view.capital} proFormaCet1={view.proFormaCet1} extraEcl={view.extraEcl} />
        ) : null}
        {desk === "ledger" ? <Ledger bookAmount={current} rows={statement(currentBook)} /> : null}
        {desk === "sources" ? <Sources /> : null}
      </main>

      <footer className="status">
        <span>
          Assets {mln(current.balance.assets)} = liabilities {mln(current.balance.liabilities)} + equity{" "}
          {mln(current.balance.equity)}
          {sheetTies ? "" : `, out by ${lari(current.balance.gap)} lari`}
        </span>
        <span>{sheetTies ? "Sheet ties" : "Sheet does not tie"}</span>
        <span>Shock {dep}%</span>
        <span>{breaches.length === 0 ? "No limit in breach" : breaches.map((limit) => limit.name).join(", ") + " in breach"}</span>
      </footer>
    </div>
  );
}

function Sources() {
  return (
    <section className="section" id="sources">
      <div>
        <h2>Sources</h2>
        <p className="working">The ceilings written into the rules, and the rates this book assumes.</p>
      </div>
      <div className="footnotes">
        {footnotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </section>
  );
}

function Position({
  result,
  text,
  forwards,
  limit,
}: {
  result: AlcoResult;
  text: string;
  forwards: { id: string; name: string; buyGel: number; currency: string }[];
  limit: number;
}) {
  return (
    <section className="section" id="position">
      <div>
        <h2 id="position-title">Open currency position</h2>
        <p className="working">{text}</p>
        <p className="method">
          Net position in a foreign currency is assets minus liabilities plus forwards that buy that currency. The overall
          position is the greater of total longs and total shorts. The ceiling is {pct(limit, 0)} of regulatory capital.
        </p>
      </div>
      <div>
        <p className="unit">Millions of lari</p>
        <div className="scroll">
          <table aria-labelledby="position-title">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th className="num" scope="col">Assets</th>
                <th className="num" scope="col">Liabilities</th>
                <th className="num" scope="col">Forwards</th>
                <th className="num" scope="col">Net</th>
                <th scope="col">Direction</th>
              </tr>
            </thead>
            <tbody>
              {result.fx.currencies.map((row) => (
                <tr key={row.currency}>
                  <th scope="row">{row.currency}</th>
                  <td className="num">{mln(row.assets)}</td>
                  <td className="num">{mln(row.liabilities)}</td>
                  <td className="num">{mln(row.forwards)}</td>
                  <td className="num">{mln(row.net)}</td>
                  <td>{direction(row.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Overall</th>
                <td />
                <td />
                <td />
                <td className="num">{mln(result.fx.overall)}</td>
                <td>{result.fx.headroom >= 0 ? "Inside the ceiling" : "Over the ceiling"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {forwards.map((forward) => (
          <p className="unit" key={forward.id}>
            {forward.name}, {forward.currency}, {mln(forward.buyGel)} million lari equivalent.
          </p>
        ))}
      </div>
    </section>
  );
}

function Liquidity({ result, text }: { result: AlcoResult; text: string }) {
  const rows: { name: string; ratio: number; floor: number; buffer: number; outflow: number; inflow: number; net: number }[] = [
    {
      name: "All currencies",
      ratio: result.lcr.all.ratio,
      floor: result.lcr.all.floor,
      buffer: result.lcr.all.hqla,
      outflow: result.lcr.all.outflows,
      inflow: result.lcr.all.inflowsCounted,
      net: result.lcr.all.netOutflow,
    },
    {
      name: "GEL",
      ratio: result.lcr.GEL.ratio,
      floor: result.lcr.GEL.floor,
      buffer: result.lcr.GEL.hqla,
      outflow: result.lcr.GEL.outflows,
      inflow: result.lcr.GEL.inflowsCounted,
      net: result.lcr.GEL.netOutflow,
    },
    {
      name: "USD",
      ratio: result.lcr.USD.ratio,
      floor: result.lcr.USD.floor,
      buffer: result.lcr.USD.hqla,
      outflow: result.lcr.USD.outflows,
      inflow: result.lcr.USD.inflowsCounted,
      net: result.lcr.USD.netOutflow,
    },
    {
      name: "EUR",
      ratio: result.lcr.EUR.ratio,
      floor: result.lcr.EUR.floor,
      buffer: result.lcr.EUR.hqla,
      outflow: result.lcr.EUR.outflows,
      inflow: result.lcr.EUR.inflowsCounted,
      net: result.lcr.EUR.netOutflow,
    },
  ];

  return (
    <section className="section" id="liquidity">
      <div>
        <h2 id="liquidity-title">Liquidity</h2>
        <p className="working">{text}</p>
        <p className="method">
          High-quality assets are taken after the Level 2 cap of two-thirds of Level 1. Inflows count only up to 75% of
          outflows. The lari floor here is {pct(result.lcr.GEL.floor, 0)} and the foreign-currency floor is{" "}
          {pct(result.lcr.USD.floor, 0)}. Stable funding is available stable funding divided by required stable funding.
        </p>
      </div>
      <div className="stack">
        <div>
          <p className="unit">Millions of lari, except the ratios</p>
          <div className="scroll">
            <table aria-labelledby="liquidity-title">
              <thead>
                <tr>
                  <th scope="col">Coverage</th>
                  <th className="num" scope="col">Buffer</th>
                  <th className="num" scope="col">Outflows</th>
                  <th className="num" scope="col">Inflows counted</th>
                  <th className="num" scope="col">Net outflow</th>
                  <th className="num" scope="col">Ratio</th>
                  <th className="num" scope="col">Floor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} data-status={row.ratio < row.floor ? "breach" : undefined}>
                    <th scope="row">{row.name}</th>
                    <td className="num">{mln(row.buffer)}</td>
                    <td className="num">{mln(row.outflow)}</td>
                    <td className="num">{mln(row.inflow)}</td>
                    <td className="num">{mln(row.net)}</td>
                    <td className="num">{pct(row.ratio)}</td>
                    <td className="num">{pct(row.floor, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="scroll">
          <table aria-label="Stable funding">
            <thead>
              <tr>
                <th scope="col">Stable funding</th>
                <th className="num" scope="col">Available</th>
                <th className="num" scope="col">Required</th>
                <th className="num" scope="col">Ratio</th>
                <th className="num" scope="col">Floor</th>
              </tr>
            </thead>
            <tbody>
              {(["all", "GEL", "USD", "EUR"] as const).map((key) => {
                const row = result.nsfr[key];
                const name = key === "all" ? "All currencies" : key;
                return (
                  <tr key={key} data-status={key === "all" && row.ratio < row.floor ? "breach" : undefined}>
                    <th scope="row">{name}</th>
                    <td className="num">{mln(row.available)}</td>
                    <td className="num">{mln(row.required)}</td>
                    <td className="num">{pct(row.ratio)}</td>
                    <td className="num">{key === "all" ? pct(row.floor, 0) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Rates({ result, text }: { result: AlcoResult; text: string }) {
  return (
    <section className="section" id="rates">
      <div>
        <h2 id="rates-title">Interest rate risk</h2>
        <p className="working">{text}</p>
        <p className="method">
          Present value uses continuous compounding on a flat reference curve. The short-rate weight is exp(−t / 4). The
          long-rate weight is one minus that. A steepener uses −0.65 on the short shock and +0.90 on the long shock. A
          flattener uses +0.80 and −0.60. Losses count in full across currencies and gains count at half. The post-shock
          rate cannot fall below zero. Twelve-month income is the repricing gap inside the year, with no discount. Forwards
          stay in the currency position and out of this calculation. Equity is excluded. {depositNote(sampleBook)}
        </p>
      </div>
      <div className="stack">
        <div className="scroll">
          <table aria-label="Reference curves and shock sizes">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th className="num" scope="col">Reference</th>
                <th className="num" scope="col">Parallel</th>
                <th className="num" scope="col">Short</th>
                <th className="num" scope="col">Long</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(sampleBook.shocks) as Currency[]).map((currency) => (
                <tr key={currency}>
                  <th scope="row">{currency === "GEL" ? "GEL, using the USD calibration" : CURRENCY_NAME[currency]}</th>
                  <td className="num">{pct(sampleBook.referenceRates[currency], 2)}</td>
                  <td className="num">{bp(sampleBook.shocks[currency].parallel)}</td>
                  <td className="num">{bp(sampleBook.shocks[currency].short)}</td>
                  <td className="num">{bp(sampleBook.shocks[currency].long)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="unit">Change in value, millions of lari. A negative currency column is a loss.</p>
          <div className="scroll">
            <table className="wide" aria-labelledby="rates-title">
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th className="num" scope="col">GEL</th>
                  <th className="num" scope="col">USD</th>
                  <th className="num" scope="col">EUR</th>
                  <th className="num" scope="col">Counted loss</th>
                  <th className="num" scope="col">Share of tier 1</th>
                  <th className="num" scope="col">12-month income</th>
                </tr>
              </thead>
              <tbody>
                {result.irrbb.scenarios.map((scenario) => {
                  const over = scenario.shareOfTier1 > result.irrbb.limit + 1e-6;
                  return (
                    <tr
                      key={scenario.id}
                      data-status={over ? "breach" : undefined}
                      data-worst={scenario.id === result.irrbb.worstId ? "yes" : "no"}
                    >
                      <th scope="row">{scenario.name}</th>
                      <td className="num">{signedMln(scenario.byCurrency.GEL)}</td>
                      <td className="num">{signedMln(scenario.byCurrency.USD)}</td>
                      <td className="num">{signedMln(scenario.byCurrency.EUR)}</td>
                      <td className="num">{mln(scenario.loss)}</td>
                      <td className="num">{pct(scenario.shareOfTier1)}</td>
                      <td className="num">{signedMln(scenario.nii)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="unit">Repricing gap, millions of lari, all currencies together</p>
          <div className="scroll">
            <table aria-label="Repricing gap">
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th className="num" scope="col">Assets</th>
                  <th className="num" scope="col">Liabilities</th>
                  <th className="num" scope="col">Gap</th>
                </tr>
              </thead>
              <tbody>
                {result.irrbb.gaps.map((gap) => (
                  <tr key={gap.name}>
                    <th scope="row">{gap.name}</th>
                    <td className="num">{mln(gap.assets)}</td>
                    <td className="num">{mln(gap.liabilities)}</td>
                    <td className="num">{mln(gap.gap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Credit({ result, text }: { result: AlcoResult; text: string }) {
  return (
    <section className="section" id="credit">
      <div>
        <h2 id="credit-title">Credit loss</h2>
        <p className="working">{text}</p>
        <p className="method">
          Stage 1 keeps the first year of a constant hazard. Stage 2 keeps every year through remaining maturity. Stage 3
          sets the annual probability to 1. The discount is annual compound at the loan's effective rate. Debt service maps
          to probability through a logistic with intercept {sampleBook.policy.pdIntercept} and slope {sampleBook.policy.pdSlope}.
          For an unhedged borrower, loss given default rises by {sampleBook.policy.lgdUpliftPerDepreciation} times the lari
          move. The lari-loan rule is checked on single facilities. The ceiling is {lari(sampleBook.policy.larizationCapGel)}{" "}
          lari.
        </p>
      </div>
      <div>
        <p className="unit">Lari</p>
        <div className="scroll">
          <table className="wide" aria-labelledby="credit-title">
            <thead>
              <tr>
                <th scope="col">Facility</th>
                <th scope="col">Loan / income</th>
                <th className="num" scope="col">Stage</th>
                <th scope="col">Lari rule</th>
                <th className="num" scope="col">Expected loss</th>
                <th className="num" scope="col">Exposure</th>
                <th className="num" scope="col">Debt service</th>
                <th className="num" scope="col">12-month PD</th>
                <th scope="col">Hedge</th>
              </tr>
            </thead>
            <tbody>
              {result.credit.loans.map((loan) => (
                <tr key={loan.id}>
                  <th scope="row">{loan.name}</th>
                  <td>{owes(loan)}</td>
                  <td className="num">{loan.stage}</td>
                  <td data-mark={loan.larization}>{ruleLabel(loan.larization)}</td>
                  <td className="num">{lari(loan.ecl)}</td>
                  <td className="num">{lari(loan.eadGel)}</td>
                  <td className="num">{pct(loan.dsr)}</td>
                  <td className="num">{pct(loan.stage === 3 ? 1 : loan.pd12, 2)}</td>
                  <td>{hedgeLabel(loan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Capital({
  result,
  text,
  proFormaCet1,
  extraEcl,
}: {
  result: AlcoResult;
  text: string;
  proFormaCet1: number;
  extraEcl: number;
}) {
  const policy = sampleBook.policy;
  const capital = result.capital;
  const proFormaRatio = capital.rwa > 0 ? proFormaCet1 / capital.rwa : 0;
  const layers = [
    ["Common equity", capital.cet1Amount, capital.cet1Ratio, capital.minimumCet1],
    ["Tier 1", capital.tier1Amount, capital.tier1Ratio, capital.minimumTier1],
    ["Total capital", capital.totalAmount, capital.totalRatio, capital.minimumTotal],
  ] as const;
  const stack = [
    ["Pillar 1 common equity", policy.pillar1Cet1],
    ["Conservation", policy.conservation],
    ["Countercyclical", policy.countercyclical],
    ["Systemic, assumed", policy.systemic],
    ["Pillar 2, assumed", policy.pillar2],
    ["Currency-induced credit", capital.cicrRatio],
  ] as const;

  return (
    <section className="section" id="capital">
      <div>
        <h2 id="capital-title">Capital</h2>
        <p className="working">{text}</p>
        <p className="method">
          Risk-weighted assets are the credit book at the line risk weights, plus 12.5 times the {pct(policy.fxCharge, 0)}{" "}
          foreign-exchange charge on the overall open position, plus the reported operational amount. The operational
          amount does not change when the lari moves. The currency add-on is the extra risk weight times unhedged exposure
          times {pct(policy.pillar1Total, 0)}, divided by risk-weighted assets. It raises the minimum. It is not also added
          to risk-weighted assets. Reported equity is already after provisions, so only the extra loss from this shock is
          taken off in the pro forma row.
        </p>
      </div>
      <div className="stack">
        <div className="scroll">
          <table aria-labelledby="capital-title">
            <thead>
              <tr>
                <th scope="col">Layer</th>
                <th className="num" scope="col">Capital</th>
                <th className="num" scope="col">Ratio</th>
                <th className="num" scope="col">Minimum</th>
                <th className="num" scope="col">Headroom</th>
              </tr>
            </thead>
            <tbody>
              {layers.map(([name, amount, ratio, minimum]) => (
                <tr key={name} data-status={ratio < minimum ? "breach" : undefined}>
                  <th scope="row">{name}</th>
                  <td className="num">{mln(amount)}</td>
                  <td className="num">{pct(ratio, 2)}</td>
                  <td className="num">{pct(minimum, 2)}</td>
                  <td className="num">{points(ratio - minimum)}</td>
                </tr>
              ))}
              {extraEcl > 0 ? (
                <tr data-status={proFormaRatio < capital.minimumCet1 ? "breach" : undefined}>
                  <th scope="row">Common equity after the extra expected loss</th>
                  <td className="num">{mln(proFormaCet1)}</td>
                  <td className="num">{pct(proFormaRatio, 2)}</td>
                  <td className="num">{pct(capital.minimumCet1, 2)}</td>
                  <td className="num">{points(proFormaRatio - capital.minimumCet1)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="scroll">
          <table aria-label="Common equity minimum">
            <thead>
              <tr>
                <th scope="col">Add-on</th>
                <th className="num" scope="col">Share of risk-weighted assets</th>
              </tr>
            </thead>
            <tbody>
              {stack.map(([name, share]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td className="num">{pct(share, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Common equity minimum</th>
                <td className="num">{pct(capital.minimumCet1, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="scroll">
          <table aria-label="Risk-weighted assets">
            <thead>
              <tr>
                <th scope="col">Risk-weighted assets</th>
                <th className="num" scope="col">Millions of lari</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Credit</th>
                <td className="num">{mln(capital.creditRwa)}</td>
              </tr>
              <tr>
                <th scope="row">Foreign exchange</th>
                <td className="num">{mln(capital.marketRwa)}</td>
              </tr>
              <tr>
                <th scope="row">Operational</th>
                <td className="num">{mln(capital.operationalRwa)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{mln(capital.rwa)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

function Ledger({ bookAmount, rows }: { bookAmount: AlcoResult; rows: ReturnType<typeof statement> }) {
  const groups = [
    ["Assets", rows.filter((row) => row.side === "asset")],
    ["Liabilities", rows.filter((row) => row.side === "liability")],
    ["Equity", rows.filter((row) => row.side === "equity")],
  ] as const;
  const gap = bookAmount.balance.gap;

  return (
    <section className="section" id="ledger">
      <div>
        <h2 id="ledger-title">Ledger</h2>
        <p className="working">
          Assets {mln(bookAmount.balance.assets)} million, liabilities {mln(bookAmount.balance.liabilities)} million, equity{" "}
          {mln(bookAmount.balance.equity)} million.
          {Math.abs(gap) >= 1 ? ` The sheet is out by ${lari(gap)} lari.` : " The sheet ties."}
        </p>
        <p className="method">
          Every runoff rate, stable-funding factor and risk weight used above is on this ledger. Cash at correspondents and
          at the National Bank is in the liquidity buffer and out of the rate calculation.
        </p>
      </div>
      <div>
        <p className="unit">Millions of lari</p>
        <div className="scroll">
          <table className="wide" aria-labelledby="ledger-title">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Currency</th>
                <th className="num" scope="col">Amount</th>
                <th scope="col">30-day factor</th>
                <th scope="col">Buffer</th>
                <th scope="col">Stable funding</th>
                <th className="num" scope="col">Risk weight</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([title, lines]) => (
                <Fragment key={title}>
                  <tr className="group">
                    <th scope="colgroup" colSpan={7}>
                      {title}
                    </th>
                  </tr>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <th scope="row">{line.name}</th>
                      <td>{line.currency}</td>
                      <td className="num">{mln(line.amountGel)}</td>
                      <td>{line.thirtyDay}</td>
                      <td>{line.hqla}</td>
                      <td>{line.stableFunding}</td>
                      <td className="num">{line.riskWeight === null ? "" : pct(line.riskWeight, 0)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
