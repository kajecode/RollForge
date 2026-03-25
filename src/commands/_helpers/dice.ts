import { DiceRoll } from "@dice-roller/rpg-dice-roller";

export type RollResult = { total: number; output: string };

export function roll(expr: string): RollResult {
  const r = new DiceRoll(expr);
  return { total: r.total, output: r.output };
}
