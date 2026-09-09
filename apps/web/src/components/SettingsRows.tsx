/**
 * The match settings, editable by the host: mode, cards each, timer, round
 * limit. Lives behind "Match settings" in the lobby, so it loads on that tap.
 */
import { GAME_MODES, GAME_MODE_INFO, type RoomSettings, type RoomView } from "@deckxi/shared";
import { PowerCard, getEdition } from "@deckxi/ui";
import { useStore } from "../store/store.js";

/** The powers in the order the table shows them, everywhere. */
const POWER_ORDER = ["powerplay", "drs", "super-over"] as const;

function PowerCardRow() {
  return (
    <div className="power-card-row-strip" aria-label="Power cards">
      {POWER_ORDER.map((kind) => (
        <PowerCard key={kind} kind={kind} size="full" />
      ))}
    </div>
  );
}

export function SettingsRows({ room, isHost }: { room: RoomView; isHost: boolean }) {
  const updateSettings = useStore((s) => s.updateSettings);
  const s = room.settings;
  const patch = (p: Partial<RoomSettings>) => void updateSettings(p).catch(() => undefined);

  const row = (
    label: string,
    value: number,
    options: number[],
    key: "cardsPerPlayer" | "turnTimerSeconds" | "maxRounds",
    unit = "",
  ) => (
    <label className="setting-row">
      <span>{label}</span>
      {isHost ? (
        <select value={value} onChange={(e) => patch({ [key]: Number(e.target.value) })}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
              {unit}
            </option>
          ))}
        </select>
      ) : (
        <strong className="chip">
          {value}
          {unit}
        </strong>
      )}
    </label>
  );

  return (
    <div className="setting-rows">
      <div className="setting-row setting-row--modes" role="radiogroup" aria-label="Game mode">
        <span>Game mode</span>
        <div className="mode-picker">
          {GAME_MODES.map((mode) => {
            const info = GAME_MODE_INFO[mode];
            const on = s.gameMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "mode-option mode-option--on" : "mode-option"}
                disabled={!isHost}
                data-testid={`mode-${mode}`}
                onClick={() => {
                  if (isHost && !on) patch({ gameMode: mode });
                }}
              >
                <strong>{info.name}</strong>
                <span className="sub">{info.blurb}</span>
                <span className="sub mode-seats">
                  {info.players.min}–{info.players.max} players
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {s.gameMode === "power-trumps" && <PowerCardRow />}
      {GAME_MODE_INFO[s.gameMode].family === "trumps" &&
        row("Cards per player", s.cardsPerPlayer, [3, 4, 5, 7, 9, 11], "cardsPerPlayer")}
      {GAME_MODE_INFO[s.gameMode].family === "trumps" && s.cardsPerPlayer < room.players.length && (
        <p className="sub setting-warning" role="status">
          Fewer cards each than players: the last seats can be out before their first call. Deal{" "}
          {room.players.length}+ each so everyone gets a go.
        </p>
      )}
      {row("Turn timer", s.turnTimerSeconds, [10, 15, 20, 30, 60], "turnTimerSeconds", "s")}
      {GAME_MODE_INFO[s.gameMode].family === "trumps" &&
        row("Round limit", s.maxRounds, [10, 25, 50, 100, 1000], "maxRounds")}
      <p className="sub">
        Deck: {getEdition(s.editionId)?.name ?? s.editionId}
        {isHost ? "" : " · the host decides"}
      </p>
    </div>
  );
}
