/**
 * What the powers did to a round, as lines a person can read — the verdict
 * sheet and the round log print the same ones, so a player who missed the
 * reveal can find the evidence later (#131).
 */
import { formatStatValue, statName } from "@deckxi/ui";
import type { ResolvedRound } from "./clientGame.js";

export function powerLines(
  round: ResolvedRound,
  editionId: string,
  names: Record<string, string>,
  selfId: string | null,
): string[] {
  const power = round.power;
  if (power === null) return [];
  const who = (id: string) => (id === selfId ? "You" : (names[id] ?? id));
  const s = (id: string) => (id === selfId ? "" : "s");
  const lines: string[] = [];
  if (power.drsBy !== null) {
    lines.push(
      `${who(power.drsBy)} called DRS: ${statName(editionId, round.stat)} overrules ${statName(editionId, power.calledStat)}`,
    );
  }
  for (const o of power.outcomes) {
    if (o.power === "drs") {
      lines.push(
        o.outcome === "won"
          ? `DRS stands — ${who(o.playerId)} lead${s(o.playerId)} next`
          : `DRS fails — ${who(o.playerId)} give${s(o.playerId)} one extra card`,
      );
    } else if (o.power === "powerplay") {
      lines.push(
        o.outcome === "won"
          ? `Powerplay pays: ${who(o.playerId)} take${s(o.playerId)} one extra from everyone`
          : `Powerplay backfires: ${who(o.playerId)} give${s(o.playerId)} one extra`,
      );
    } else if (o.outcome === "void") {
      lines.push(`${who(o.playerId)}: Super Over not needed — handed back`);
    }
  }
  for (const so of power.superOvers) {
    const c = formatStatValue(editionId, round.stat, so.challengerCard.value);
    const d = formatStatValue(editionId, round.stat, so.defenderCard.value);
    lines.push(
      so.winner === null
        ? `Super Over: ${who(so.challenger)} ${c} v ${who(so.defender)} ${d} — falls short, card lost`
        : `Super Over: ${who(so.challenger)} ${c} v ${who(so.defender)} ${d} — takes the lot!`,
    );
  }
  return lines;
}
