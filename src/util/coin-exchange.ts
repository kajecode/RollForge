export type CoinParts = { pp: number; gp: number; ep: number; sp: number; cp: number };

export type FormatOptions = {
  /**
   * Show platinum? Defaults false (many tables stick to gp/sp/cp).
   * If enabled, 10 gp = 1 pp.
   */
  usePlatinum?: boolean;

  /**
   * Show electrum? Defaults false (optional in 5e).
   * 1 ep = 5 sp = 0.5 gp.
   */
  useElectrum?: boolean;

  /**
   * If the computed price is 0 cp, render as "0 gp" (false) or "free" (true).
   * Default false.
   */
  showFree?: boolean;

  /**
   * Separator between denominations, e.g., " " => "1 gp 5 sp"
   * Default " ".
   */
  sep?: string;

  /**
   * If true, hides zero denominations (so "1 gp 0 sp 4 cp" → "1 gp 4 cp").
   * Default true.
   */
  compact?: boolean;

  /**
   * If true, omits "0 cp" when gp or sp present (common for neat tables).
   * Default true.
   */
  omitTrailingZeroCp?: boolean;
};

const DEFAULTS: Required<FormatOptions> = {
  usePlatinum: false,
  useElectrum: false,
  showFree: false,
  sep: " ",
  compact: true,
  omitTrailingZeroCp: true,
};

/** Convert a floating price in gp -> integer copper (cp) safely. */
export function gpToCp(gp: number): number {
  // avoid float errors like 0.1 * 100 = 9.999...
  return Math.round((gp ?? 0) * 100);
}

/** Break total cp into coin parts according to enabled denominations. */
export function cpToCoins(cpTotal: number, opts: FormatOptions = {}): CoinParts {
  const { usePlatinum, useElectrum } = { ...DEFAULTS, ...opts };

  // 1 gp = 100 cp, 1 sp = 10 cp, 1 pp = 1000 cp, 1 ep = 50 cp
  let remaining = Math.max(0, Math.floor(cpTotal));
  const pp = usePlatinum ? Math.floor(remaining / 1000) : 0;
  remaining -= pp * 1000;

  const gp = Math.floor(remaining / 100);
  remaining -= gp * 100;

  const ep = useElectrum ? Math.floor(remaining / 50) : 0;
  remaining -= ep * 50;

  const sp = Math.floor(remaining / 10);
  remaining -= sp * 10;

  const cp = remaining;

  return { pp, gp, ep, sp, cp };
}

/** Format a gp float like 0.2 → "2 sp", 0.04 → "4 cp", 12.34 → "12 gp 3 sp 4 cp". */
export function formatPriceGP(gp: number, options: FormatOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  const cpTotal = gpToCp(gp);
  if (cpTotal === 0) return opts.showFree ? "free" : "0 gp";

  const parts = cpToCoins(cpTotal, opts);
  const strings: string[] = [];

  const push = (n: number, label: string) => {
    if (opts.compact && n === 0) return;
    strings.push(`${n} ${label}`);
  };

  if (opts.usePlatinum) push(parts.pp, "pp");
  push(parts.gp, "gp");
  if (opts.useElectrum) push(parts.ep, "ep");
  // Optionally omit trailing "0 cp" noise
  if (
    opts.omitTrailingZeroCp &&
    parts.cp === 0 &&
    (parts.gp > 0 || parts.sp > 0 || parts.pp > 0 || parts.ep > 0)
  ) {
    if (parts.sp > 0) push(parts.sp, "sp");
  } else {
    push(parts.sp, "sp");
    push(parts.cp, "cp");
  }

  // If compact removed everything but gp and gp is 0 (e.g., 0.2 gp), we still need sp/cp
  // However, the logic above already ensures at least one nonzero denomination is included.

  return strings.join(opts.sep).trim();
}
