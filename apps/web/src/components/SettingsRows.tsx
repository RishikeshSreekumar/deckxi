/**
 * The match settings, editable by the host: mode, edition, the numbers, the
 * powers and the deck. Lives behind "Match settings" in the lobby, so it
 * loads on that tap.
 *
 * The sheet is chips and numbers, not prose. Every choice is a row of chips
 * and only the *chosen* one explains itself, in one line underneath — three
 * modes each carrying a paragraph made the sheet a wall of text you had to
 * scroll past to reach the number you came to change. The numbers are tiles:
 * a big value with a small label, which is the same shape the lobby's match
 * setup prints, so the sheet reads as the editable version of that card.
 */
import {
  DEFAULT_DECK_ID,
  GAME_MODES,
  GAME_MODE_INFO,
  POWER_RECHARGE_INFO,
  type GameModeId,
  type RoomSettings,
  type RoomView,
} from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { deckOf, useDecks } from "../lib/decks.js";
import { useAllEditions, useEdition } from "../lib/editions.js";
import "./settingsRows.css";

/** A titled block of the sheet: an eyebrow, then whatever it controls. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <span className="label">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SettingsRows({ room, isHost }: { room: RoomView; isHost: boolean }) {
  const updateSettings = useStore((s) => s.updateSettings);
  const s = room.settings;
  const patch = (p: Partial<RoomSettings>) => void updateSettings(p).catch(() => undefined);
  const edition = useEdition(s.editionId);
  // The deck list is server-curated (#142); the built-ins render until it lands.
  const decks = useDecks(s.editionId);
  const chosen = room.deck ?? deckOf(decks, s.deckId);
  const poolSize = chosen.cardCount > 0 ? chosen.cardCount : null;
  const needed = room.players.length * s.cardsPerPlayer;
  // The modes this build knows, cut to the ones the pinned edition is played
  // in (#143) — the server refuses the rest, so the picker never offers them.
  // An edition this build doesn't bundle falls back to all of them.
  const modes =
    edition === null
      ? GAME_MODES
      : GAME_MODES.filter((mode) => edition.supportedModes.includes(mode));
  const editions = useAllEditions();
  const mode = GAME_MODE_INFO[s.gameMode];
  const trumps = mode.family === "trumps";

  /**
   * Switching edition switches sport (#143), so the mode and the deck go with
   * it: a WWE room cannot be in Squad Draft, and "Bowlers' Union" is not one
   * of its decks. Both fall back to the new edition's own defaults.
   */
  const selectEdition = (editionId: string) => {
    const next = editions.find((e) => e.id === editionId);
    const gameMode =
      (next?.supportedModes.includes(s.gameMode) ?? true)
        ? s.gameMode
        : ((next?.supportedModes[0] ?? s.gameMode) as GameModeId);
    patch({ editionId, gameMode, deckId: DEFAULT_DECK_ID });
  };

  /**
   * One number, as a tile: the value is the thing you read, the label is the
   * small print. The control is a native `select` — a picker every platform
   * already knows — sized to cover the tile so the whole tile is the target.
   */
  const tile = (
    label: string,
    value: number,
    options: number[],
    key: "cardsPerPlayer" | "turnTimerSeconds" | "maxRounds" | "choiceDepth",
    unit = "",
  ) => (
    <label className="setting-row set-tile" key={key}>
      <span className="set-tile-label">{label}</span>
      <span className="set-tile-value">
        {value}
        {unit}
      </span>
      {isHost && (
        <select
          className="set-tile-select"
          value={value}
          aria-label={label}
          onChange={(e) => patch({ [key]: Number(e.target.value) })}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
              {unit}
            </option>
          ))}
        </select>
      )}
    </label>
  );

  /** A row of chips where exactly one is on — the sheet's one choice shape. */
  const chips = <T extends string>(
    label: string,
    items: { id: T; name: string; note?: string | undefined; testId?: string | undefined }[],
    current: T,
    pick: (id: T) => void,
  ) => (
    <div className="set-chips" role="radiogroup" aria-label={label}>
      {items.map((item) => {
        const on = item.id === current;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`chip ${on ? "chip--on" : ""}`}
            disabled={!isHost}
            data-testid={item.testId}
            onClick={() => {
              if (isHost && !on) pick(item.id);
            }}
          >
            {item.name}
            {item.note !== undefined && <span className="set-chip-note">{item.note}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="set-sheet">
      {!isHost && (
        <p className="sub set-readonly" role="status">
          The host sets these.
        </p>
      )}

      <Section
        title="Mode"
        aside={
          <span className="sub set-aside">
            {mode.players.min}–{mode.players.max} players
          </span>
        }
      >
        {chips(
          "Game mode",
          modes.map((id) => ({ id, name: GAME_MODE_INFO[id].name, testId: `mode-${id}` })),
          s.gameMode,
          (id) => patch({ gameMode: id }),
        )}
        <p className="sub set-note">{mode.blurb}</p>
      </Section>

      {editions.length > 1 && (
        <Section title="Edition">
          {chips(
            "Edition",
            editions.map((e) => ({ id: e.id, name: e.name, testId: `edition-${e.id}` })),
            s.editionId,
            selectEdition,
          )}
        </Section>
      )}

      <Section title="Numbers">
        <div className="set-tiles">
          {trumps && tile("Cards each", s.cardsPerPlayer, [3, 4, 5, 7, 9, 11], "cardsPerPlayer")}
          {s.gameMode === "power-trumps" &&
            tile("Pick from", s.choiceDepth, [1, 2, 3], "choiceDepth")}
          {tile("Turn timer", s.turnTimerSeconds, [10, 15, 20, 30, 60], "turnTimerSeconds", "s")}
          {trumps && tile("Rounds", s.maxRounds, [10, 20, 25, 30, 50, 100, 1000], "maxRounds")}
        </div>
        {trumps && s.cardsPerPlayer < room.players.length && (
          <p className="sub set-warn" role="status">
            {s.cardsPerPlayer} each, {room.players.length} playing — late seats may never call.
          </p>
        )}
      </Section>

      {s.gameMode === "power-trumps" && (
        <Section title="Powers back">
          {chips(
            "Powers come back",
            (Object.keys(POWER_RECHARGE_INFO) as RoomSettings["powerRecharge"][]).map((k) => ({
              id: k,
              name: POWER_RECHARGE_INFO[k].name,
            })),
            s.powerRecharge,
            (powerRecharge) => patch({ powerRecharge }),
          )}
          <p className="sub set-note">{POWER_RECHARGE_INFO[s.powerRecharge].blurb}</p>
        </Section>
      )}

      <Section
        title="Deck"
        aside={
          // A host picking a deck blind is how "Bowlers' Union" stays a
          // mystery until the cards land; the link opens the deck itself (#141).
          <a
            className="sub set-aside"
            href={`/deck?deck=${s.deckId}&edition=${s.editionId}`}
            target="_blank"
            rel="noreferrer"
          >
            Browse →
          </a>
        }
      >
        {chips(
          "Deck",
          decks.map((deck) => ({
            id: deck.id,
            name: deck.name,
            note: deck.cardCount > 0 ? String(deck.cardCount) : undefined,
            testId: `deck-${deck.id}`,
          })),
          s.deckId,
          (deckId) => patch({ deckId }),
        )}
        <p className="sub set-note">{chosen.blurb}</p>
        {poolSize !== null && poolSize < needed && (
          <p className="sub set-warn" role="status">
            Needs {needed} cards, {chosen.name} has {poolSize}.
          </p>
        )}
      </Section>
    </div>
  );
}
