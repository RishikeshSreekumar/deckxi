/**
 * Client-side sanity checks on the game as it arrives. Nothing here changes
 * state; it only shouts when the wire says something that cannot be true.
 * Split from the mirror so the checks cost the initial payload nothing.
 */
import type { RedactedGameEvent } from "@deckxi/shared";
import type { ClientGameState } from "./clientGame.js";

/**
 * A reveal that cannot be right is a bug somewhere between the engine and
 * this screen, and nothing on screen would say so — the playtest saw a card
 * count that did not match the cards shown and a winning value that matched
 * no card, and both went by in silence. Reported through console.error so
 * the playtest capture (and a dev console) catches it; the state is still
 * applied, because the server's word is final.
 */
export function invariant(message: string): void {
  console.error(`[deckxi invariant] ${message}`);
}

export function checkReveal(
  state: ClientGameState,
  event: Extract<RedactedGameEvent, { type: "ROUND_RESOLVED" }>,
): void {
  const seen = new Set<string>();
  for (const r of event.revealed) {
    if (seen.has(r.playerId)) invariant(`round ${event.round}: ${r.playerId} revealed twice`);
    seen.add(r.playerId);
    if (!state.active[r.playerId]) {
      invariant(`round ${event.round}: ${r.playerId} revealed a card while out`);
    }
  }
  for (const id of state.config.players) {
    if (state.active[id] && !seen.has(id)) {
      invariant(`round ${event.round}: ${id} is in the game but played no card`);
    }
  }
  const def = state.config.stats.find((s) => s.key === event.stat);
  if (def === undefined || event.revealed.length === 0) return;
  const best = event.revealed.reduce((a, b) =>
    (def.direction === "higher" ? b.value > a.value : b.value < a.value) ? b : a,
  );
  const bests = event.revealed.filter((r) => r.value === best.value).map((r) => r.playerId);
  if (event.result.kind === "won") {
    if (!bests.includes(event.result.winner) || bests.length !== 1) {
      invariant(
        `round ${event.round}: ${event.result.winner} took it on ${event.stat} but the best value ${best.value} belongs to ${bests.join(", ")}`,
      );
    }
  } else if (bests.length < 2) {
    invariant(
      `round ${event.round}: called a tie on ${event.stat} but ${best.playerId} was best alone`,
    );
  }
}
