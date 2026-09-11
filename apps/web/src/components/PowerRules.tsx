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
            Pick any of your top cards (two, unless the host set otherwise). The call goes round the
            table, one seat a round.
          </span>
        </li>
        <li>
          <strong>One stat per card</strong>
          <span className="sub">
            A stat a card has been called on is <s>struck out</s> on that card for the rest of the
            game. Every other card still has it.
          </span>
        </li>
        <li>
          <strong>Every power is a bet</strong>
          <span className="sub">
            Works: a big win. Fails: exactly one extra card. One power per round; the row says when
            spent powers come back.
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
