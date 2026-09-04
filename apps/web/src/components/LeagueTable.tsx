/**
 * The Squad Draft league table — shared by the reveal on the table and the
 * results screen, and small enough to sit in the initial bundle so the
 * results screen never has to load the whole draft board to show it.
 */
import type { SquadClientState } from "../game/squadClient.js";

export function LeagueTable({
  state,
  names,
  selfId,
}: {
  state: SquadClientState;
  names: Record<string, string>;
  selfId: string | null;
}) {
  const table = state.league?.table ?? [];
  return (
    <table className="league-table" data-testid="league-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Side</th>
          <th scope="col">P</th>
          <th scope="col">W</th>
          <th scope="col">D</th>
          <th scope="col">L</th>
          <th scope="col">±</th>
          <th scope="col">Pts</th>
        </tr>
      </thead>
      <tbody>
        {table.map((row, i) => (
          <tr key={row.playerId} className={i === 0 ? "league-row--top" : ""}>
            <td>{i + 1}</td>
            <td className="league-name">
              {row.playerId === selfId ? "You" : (names[row.playerId] ?? "?")}
            </td>
            <td>{row.played}</td>
            <td>{row.won}</td>
            <td>{row.drawn}</td>
            <td>{row.lost}</td>
            <td>{row.margin > 0 ? `+${row.margin}` : row.margin}</td>
            <td>
              <strong>{row.points}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
