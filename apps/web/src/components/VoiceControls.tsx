/**
 * Voice controls (#89): join the call, hold to talk, or latch the mic open.
 *
 * Two rules the UI has to keep, whatever else changes:
 *
 *   1. A live mic is always visible — the button says so about you, and every
 *      seat shows a dot for anyone else who is live. There is no state in
 *      which this game is listening to a room without saying so.
 *   2. Refusing the microphone is a normal answer. The table carries on, the
 *      button says voice is off, and nothing asks again.
 *
 * Voice is only ever offered in a private room opened by invite. Public
 * matchmaking has no moderation story for it, and until it does, quick-match
 * tables do not get a mic button.
 */
import { useEffect } from "react";
import { useStore } from "../store/store.js";

export function VoiceControls() {
  const voice = useStore((s) => s.voice);
  const muted = useStore((s) => s.voiceMuted);
  const startVoice = useStore((s) => s.startVoice);
  const stopVoice = useStore((s) => s.stopVoice);
  const setVoiceMuted = useStore((s) => s.setVoiceMuted);
  const room = useStore((s) => s.room);
  const spectator = useStore((s) => s.spectator);
  const practice = useStore((s) => s.practice);

  // Leaving the room takes the call with it: an open mic in a game you are no
  // longer in is the worst bug this feature could have.
  useEffect(() => {
    if (room === null && voice !== "off") stopVoice();
  }, [room, voice, stopVoice]);

  if (room === null || spectator || practice) return null;

  if (voice === "denied") {
    return (
      <p className="hint voice-hint" data-testid="voice-denied">
        Voice is off — your browser didn't give us the mic. You can turn it on in the site settings
        and rejoin.
      </p>
    );
  }

  if (voice === "off") {
    return (
      <button
        type="button"
        className="button button--sm voice-button"
        data-testid="voice-join"
        onClick={() => void startVoice()}
      >
        Join voice
      </button>
    );
  }

  const busy = voice === "connecting";
  return (
    <div className="voice-controls" data-testid="voice-controls">
      <button
        type="button"
        className={`button button--sm voice-button${!muted ? " voice-button--live" : ""}`}
        aria-pressed={!muted}
        disabled={busy}
        data-testid="voice-mute"
        onClick={() => setVoiceMuted(!muted)}
        // Push-to-talk: hold the button. The toggle above is the same state,
        // so a player can pick whichever suits the hand they have free.
        onPointerDown={() => {
          if (muted) setVoiceMuted(false);
        }}
        onPointerUp={() => {
          if (!muted) setVoiceMuted(true);
        }}
      >
        {busy ? "Connecting…" : muted ? "Mic off" : "Mic live"}
      </button>
      <button
        type="button"
        className="button button--ghost button--sm"
        onClick={stopVoice}
        data-testid="voice-leave"
      >
        Leave voice
      </button>
    </div>
  );
}
