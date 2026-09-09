/**
 * The rules, as a sheet a player can open from the landing page, the lobby
 * and the table. The playtest's most-repeated finding was that nothing in
 * the app said which way a stat wins — the *host* could not answer whether
 * an economy of 4 beats 8 — and the only button that promised rules opened
 * the match settings. So this is written for the person who has never seen
 * a trump card: what the game is, what each stat means, which direction
 * takes it, and what a dash or 4/16 counts as.
 *
 * Lazy-loaded wherever it appears: rules copy for eight stats is not
 * initial-payload material (#107).
 */
import { GAME_MODE_INFO, type GameModeId } from "@deckxi/shared";
import { DEFAULT_EDITION_ID, Dialog, getEdition } from "@deckxi/ui";
import "./howToPlay.css";

/** What each stat measures, keyed the way the edition keys them. */
const STAT_MEANING: Record<string, string> = {
  battingAvg: "Runs scored per time out, with the bat.",
  strikeRate: "Runs scored per 100 balls faced — how fast they score.",
  runs: "Career runs in T20 internationals.",
  highest: "Their best single-innings score.",
  wickets: "Career wickets in T20 internationals.",
  economy: "Runs given away per over bowled. Fewer is better.",
  catches: "Career catches in the field.",
  bestBowling: "Best figures in one match, as wickets/runs (4/16 = four wickets for 16 runs).",
};

export function HowToPlay({
  editionId = DEFAULT_EDITION_ID,
  gameMode = "classic-trumps",
  onClose,
}: {
  editionId?: string;
  gameMode?: GameModeId;
  onClose: () => void;
}) {
  const stats = getEdition(editionId)?.stats ?? [];
  return (
    <Dialog title="How to play" onClose={onClose}>
      <div className="rules-sheet" data-testid="how-to-play">
        <p className="rules-text">
          DeckXI is cricket top trumps. Every card is a real player with eight numbers on it. Each
          round one of you <strong>calls a stat</strong>; everyone's top card is compared on that
          stat, and the best value <strong>takes every card played</strong>. Run out of cards and
          you're out. Last one holding cards wins.
        </p>

        <ol className="rules-steps">
          <li>
            <strong>The call goes round the table.</strong> One seat clockwise each round, win or
            lose — everyone gets to pick.
          </li>
          <li>
            <strong>Your turn:</strong> tap a stat row on your card, then <strong>Call</strong> to
            send it. Pick the number you think beats everyone else's hidden top card.
          </li>
          <li>
            <strong>Everyone else's turn:</strong> your top card plays itself. Nothing to press —
            the reveal shows whether it held up.
          </li>
          <li>
            <strong>A tie for best</strong> sends every card played to the pot; whoever wins the
            next round takes the pot too.
          </li>
          <li>
            <strong>Out of time?</strong> The timer picks your strongest stat for you.
          </li>
          {gameMode === "power-trumps" && (
            <li>
              <strong>Power trumps:</strong> play any of your top three cards, never repeat last
              round's stat, and spend three one-shot powers — each a bet that your card is strong.
            </li>
          )}
        </ol>

        <h3 className="rules-heading">The stats — and which way wins</h3>
        <ul className="rules-glossary">
          {stats.map((def) => {
            const lower = def.direction === "lower";
            return (
              <li key={def.key} className={lower ? "rules-stat rules-stat--lower" : "rules-stat"}>
                <span className="rules-stat-dir" aria-hidden="true">
                  {lower ? "↓" : "↑"}
                </span>
                <span className="rules-stat-body">
                  <strong>{def.name}</strong>
                  <em>{lower ? "lower wins" : "higher wins"}</em>
                  <span className="sub">{STAT_MEANING[def.key] ?? ""}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="sub">
          Best bowling ranks by wickets first, then by fewer runs: 4/22 beats 3/17. A dash means no
          record — it counts as the worst possible value for that stat, so never call it.
        </p>
        <p className="sub">
          <strong>{GAME_MODE_INFO[gameMode].name}:</strong> {GAME_MODE_INFO[gameMode].blurb}
        </p>
      </div>
      <button type="button" className="button" onClick={onClose}>
        Got it
      </button>
    </Dialog>
  );
}
