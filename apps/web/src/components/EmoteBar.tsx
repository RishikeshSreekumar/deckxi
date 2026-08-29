/**
 * One-tap emote reactions during a game (server rate-limits per player).
 */
import { EMOTES } from "@deckxi/shared";
import { useStore } from "../store/store.js";

export function EmoteBar() {
  const react = useStore((s) => s.react);
  return (
    <div className="emote-bar" aria-label="Reactions">
      {EMOTES.map((emote) => (
        <button
          key={emote}
          type="button"
          className="emote-button"
          onClick={() => void react(emote).catch(() => undefined)}
        >
          {emote}
        </button>
      ))}
    </div>
  );
}
