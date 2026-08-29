/**
 * The trump card renderer — team-colored frame, rarity treatment, and a big
 * legible stat table (stats are gameplay, not decoration). Data-driven from
 * the edition dataset; unknown cards render a graceful fallback.
 */
import { getCardInfo, getEdition, formatStatValue, statName } from "../lib/editions.js";

export type CardSize = "hand" | "reveal" | "full";

export interface TrumpCardProps {
  editionId: string;
  cardId: string | null;
  size?: CardSize;
  faceDown?: boolean;
  /** Stat key to highlight (the round's pick). */
  highlightStat?: string;
  /** When set, stat rows become buttons — the leader picking their stat. */
  onSelectStat?: (stat: string) => void;
  /** Optimistically selected stat awaiting the server. */
  pendingStat?: string;
  outcome?: "winner" | "loser" | undefined;
}

const ROLE_ICONS: Record<string, string> = {
  batter: "🏏",
  bowler: "🎯",
  "all-rounder": "⚡",
  keeper: "🧤",
};

export function TrumpCard({
  editionId,
  cardId,
  size = "hand",
  faceDown = false,
  highlightStat,
  onSelectStat,
  pendingStat,
  outcome,
}: TrumpCardProps) {
  if (faceDown || cardId === null) {
    return (
      <div className={`card card--${size} card--back`} aria-label="Face-down card">
        <div className="card-back-mark">XI</div>
      </div>
    );
  }

  const { player, team } = getCardInfo(editionId, cardId);
  const edition = getEdition(editionId);
  const color = team?.color ?? "#3b4a6b";
  const rarity = player?.rarity ?? "regular";
  const stats = edition?.stats ?? [];

  const classes = [
    "card",
    `card--${size}`,
    `card--${rarity}`,
    outcome === "winner" ? "card--winner" : "",
    outcome === "loser" ? "card--loser" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ "--team-color": color } as React.CSSProperties}>
      <header className="card-head">
        <span className="card-name">{player?.name ?? cardId}</span>
        <span className="card-meta">
          {team?.shortName ?? "?"} · {ROLE_ICONS[player?.role ?? ""] ?? "❔"}
          {rarity === "legend" ? " ★" : rarity === "star" ? " ✦" : ""}
        </span>
      </header>
      {size !== "hand" && player !== null && (
        <div className="card-rating" aria-label={`Overall rating ${Math.round(player.rating)}`}>
          {Math.round(player.rating)}
        </div>
      )}
      <ul className="card-stats">
        {stats.map((def) => {
          const value = player?.stats[def.key];
          const display = value === undefined ? "—" : formatStatValue(editionId, def.key, value);
          const highlighted = highlightStat === def.key || pendingStat === def.key;
          const row = (
            <>
              <span className="stat-name">{statName(editionId, def.key)}</span>
              <span
                className="stat-dir"
                title={def.direction === "lower" ? "lower wins" : "higher wins"}
              >
                {def.direction === "lower" ? "▼" : "▲"}
              </span>
              <span className="stat-value">{display}</span>
            </>
          );
          return (
            <li key={def.key} className={highlighted ? "stat-row stat-row--hot" : "stat-row"}>
              {onSelectStat !== undefined ? (
                <button
                  type="button"
                  className="stat-button"
                  data-stat={def.key}
                  onClick={() => onSelectStat(def.key)}
                >
                  {row}
                </button>
              ) : (
                <div className="stat-static">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
