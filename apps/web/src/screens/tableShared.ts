/**
 * The two table exports other modules need — kept out of GameTable.tsx so
 * the results screen and the visual fixtures can import them without pulling
 * the whole (lazy) table into their chunk.
 */

/**
 * How long each beat of the reveal holds. Mutable so the visual-regression
 * fixtures can freeze the verdict for a screenshot instead of racing it;
 * nothing in the running app writes to it.
 */
export const revealTiming = { flipMs: 1100, verdictMs: 3200, superMs: 3600 };

/** 1 → "st", 2 → "nd" … for a placing. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
