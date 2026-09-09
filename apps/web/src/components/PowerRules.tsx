/**
 * What the three powers do, printed as cards — the table's "?" sheet in
 * power trumps. `myPowers` greys out the ones you have spent; null for a
 * spectator, who has none to spend.
 */
import type { PowerKindView } from "@deckxi/shared";
import { Dialog, PowerCard } from "@deckxi/ui";

const POWER_ORDER: readonly PowerKindView[] = ["powerplay", "drs", "super-over"];

export function PowerRules({
  myPowers,
  onClose,
}: {
  myPowers: readonly PowerKindView[] | null;
  onClose: () => void;
}) {
  return (
    <Dialog title="Power trumps" onClose={onClose}>
      <ul className="power-legend">
        <li>
          <strong>Your play</strong>
          <span className="sub">
            Pick any of your top cards (two, unless the host set otherwise). The leader calls a stat
            — but a stat that has decided a round is burned for everyone until every stat has been
            used, then the sheet resets. The call goes round the table.
          </span>
        </li>
        <li>
          <strong>Every power is a bet</strong>
          <span className="sub">
            Works: a big win. Fails: exactly one extra card. One power per round, each once a game.
          </span>
        </li>
      </ul>
      <div className="power-card-row-strip" aria-label="Power cards">
        {POWER_ORDER.map((kind) => (
          <PowerCard
            key={kind}
            kind={kind}
            size="full"
            spent={myPowers !== null && !myPowers.includes(kind)}
          />
        ))}
      </div>
      <button type="button" className="button" onClick={onClose}>
        Got it
      </button>
    </Dialog>
  );
}
