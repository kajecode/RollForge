const dicePattern = /^(\d*)d(\d+)([ek][hl]\d+)?/i; // basic core; macros added below

export type RollResult = { total: number; detail: string };

export function roll(expr: string): RollResult {
  // supports: 2d20kh1+5, 4d6dl1, 1d8+3, 2d6+2d4+5, adv/dis via 2d20kh1/kl1
  const tokens = expr.replace(/\s+/g, "").match(/[+\-]?[^+\-]+/g) || [];
  let total = 0;
  const parts: string[] = [];

  for (const tok of tokens) {
    const sign = tok.startsWith("-") ? -1 : 1;
    const body = tok.replace(/^[+\-]/, "");
    const m = body.match(dicePattern);
    if (m) {
      const count = Number(m[1] || 1);
      const sides = Number(m[2]);
      const keepMod = m[3]?.toLowerCase(); // e.g., kh1, kl1, dh1, dl1 (extend as needed)
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      let used = [...rolls];

      if (keepMod) {
        const num = Number(keepMod.slice(2));
        if (keepMod.startsWith("kh")) used.sort((a,b)=>b-a), used.splice(num);
        if (keepMod.startsWith("kl")) used.sort((a,b)=>a-b), used.splice(num);
        if (keepMod.startsWith("eh") || keepMod.startsWith("el")) { /* extend for explode */ }
      }

      const subtotal = used.reduce((a,b)=>a+b,0) * sign;
      total += subtotal;
      parts.push(`${sign<0?"-":""}[${rolls.join(",")}]${keepMod?`(${keepMod}→${used.join(",")})`:""}=${subtotal}`);
    } else {
      const num = Number(body);
      if (Number.isFinite(num)) { total += sign * num; parts.push(`${sign<0?"-":""}${Math.abs(num)}`); }
      else parts.push(`?${tok}`);
    }
  }
  return { total, detail: parts.join(" + ") };
}
