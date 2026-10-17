const amount = (value: number, digits: number) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function mln(amountGel: number, digits = 1): string {
  return amount(amountGel / 1_000_000, digits);
}

export function signedMln(amountGel: number, digits = 1): string {
  const rounded = Number((amountGel / 1_000_000).toFixed(digits));
  if (rounded === 0) return amount(0, digits);
  const body = amount(Math.abs(amountGel) / 1_000_000, digits);
  return amountGel < 0 ? `−${body}` : `+${body}`;
}

export function pct(ratio: number, digits = 1): string {
  return `${amount(ratio * 100, digits)}%`;
}

export function lari(amountGel: number): string {
  return Math.round(amountGel).toLocaleString("en-GB");
}

export function bp(shock: number): string {
  return `${Math.round(shock * 10_000)} bp`;
}

export function points(delta: number): string {
  const value = delta * 100;
  const body = Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value < 0) return `−${body} pp`;
  return `+${body} pp`;
}
