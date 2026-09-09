/**
 * The round log: one line per round resolved — who called what, who took
 * it, with what number. Shown behind a button at the table and in full on
 * the results screen. The playtest's competitive player saw no reveal at
 * all in ten rounds and "was being told I lost and given zero evidence";
 * this is the evidence, kept.
 */
import { formatStatValue, statName } from "@deckxi/ui";
import type { ResolvedRound } from "../game/clientGame.js";
import "./roundLog.css";

export function RoundLog({
  history,
  editionId,
  names,
  selfId,
  limit,
}: {
  history: readonly ResolvedRound[];
  editionId: string;
  names: Record<string, string>;
  selfId: string | null;
  /** Show only the most recent rounds. */
  limit?: number;
}) {
  const who = (id: string) => (id === selfId ? "You" : (names[id] ?? id));
  const rows = limit === undefined ? history : history.slice(-limit);
  if (rows.length === 0) {
    return <p className="sub round-log-empty">No rounds played yet.</p>;
  }
  return (
    <ol className="round-log" data-testid="round-log" reversed>
      {[...rows].reverse().map((round) => {
        const caller = round.revealed[0]?.playerId ?? "";
        const stat = statName(editionId, round.stat);
        const yours = round.revealed.find((r) => r.playerId === selfId);
        let verdict: string;
        if (round.result.kind === "tie") {
          verdict = `tie — ${round.revealed.length} to the pot`;
        } else {
          const winner = round.result.winner;
          const value = round.revealed.find((r) => r.playerId === winner)?.value ?? 0;
          verdict = `${who(winner)} ${winner === selfId ? "take" : "takes"} it with ${formatStatValue(editionId, round.stat, value)}`;
        }
        return (
          <li
            key={round.seq}
            className={
              round.result.kind === "won" && round.result.winner === selfId
                ? "round-log-row round-log-row--won"
                : "round-log-row"
            }
          >
            <span className="round-log-round">R{round.round}</span>
            <span className="round-log-body">
              {round.auto ? (
                <>
                  the timer called {stat} for <strong>{who(caller)}</strong>
                </>
              ) : (
                <>
                  <strong>{who(caller)}</strong> called {stat}
                </>
              )}
              {round.power?.drsBy != null
                ? ` · DRS by ${who(round.power.drsBy)} on ${statName(editionId, round.power.calledStat)}`
                : ""}{" "}
              · {verdict}
              {yours !== undefined && round.revealed.length > 1 && (
                <span className="sub">
                  {" "}
                  (you: {formatStatValue(editionId, round.stat, yours.value)})
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
