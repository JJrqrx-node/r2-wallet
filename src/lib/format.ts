// Number formatting helpers. The chain returns values as strings to preserve
// precision; we keep that discipline and only convert at display time.

import BigNumber from "bignumber.js";

BigNumber.config({ DECIMAL_PLACES: 30, EXPONENTIAL_AT: 1e9 });

export function fmtPrice(value: string | number, decimals = 8): string {
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  return n.toFixed(decimals);
}

export function fmtAmount(value: string | number, decimals = 5): string {
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  const [intPart, frac] = n.toFixed(decimals).split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

// Display a chain amount with up to `maxDecimals` of precision but trim
// trailing zeros so 30000 RQRX-units (precision 5) renders as "0.3" and
// 30000 RQETH-units (precision 8) renders as "0.0003".
// Whole numbers are shown without a decimal point.
export function fmtAmountTrim(value: string | number, maxDecimals = 8): string {
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  // Round to maxDecimals then strip trailing zeros / dangling ".".
  let s = n.toFixed(maxDecimals);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  const [intPart, frac] = s.split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

export function fmtUSD(value: BigNumber.Value | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  const abs = n.abs();
  let decimals: number;
  if (abs.gte(1000)) decimals = 2;
  else if (abs.gte(1)) decimals = 2;
  else if (abs.gte(0.01)) decimals = 4;
  else decimals = 6;
  return `$${fmtAmount(n.toFixed(decimals), decimals)}`;
}

export function fmtUSDFixed(
  value: BigNumber.Value | null | undefined,
  decimals: number
): string {
  if (value === null || value === undefined) return "-";
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  return `$${fmtAmount(n.toFixed(decimals), decimals)}`;
}

export function fmtPercent(value: string | number): string {
  const n = new BigNumber(value);
  if (n.isNaN()) return "-";
  const sign = n.gt(0) ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
