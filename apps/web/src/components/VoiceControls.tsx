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
import { Icon, LeaveIcon } from "./Chrome.js";
import { useStore } from "../store/store.js";

/**
 * The mic icons live here rather than in `Chrome.tsx`: that file is in the
 * initial bundle, this component is not, and the initial bundle has a budget
 * measured in tenths of a kilobyte.
 *
 * A microphone: the voice button's whole label at the table (#89).
 */
function MicIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Icon>
  );
}

/** The same microphone with a stroke through it: off, and visibly so. */
function MicOffIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M9 9v3a3 3 0 0 0 4.6 2.5" />
      <path d="M15 11.4V7a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a6.9 6.9 0 0 1-.8 3.2" />
      <path d="M12 18v3" />
      <path d="M4 3l16 18" />
    </Icon>
  );
}

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

  // Quick-match tables are strangers: no mic button, and the server refuses
  // signalling there too, so this is a convenience rather than the rule.
  if (room === null || spectator || practice || room.matchmade === true) return null;

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
  // The mic is an icon, not a word: it sits in a row of icon buttons at the
  // bottom of the table, and "Mic live" spelled out crowded the row off the
  // screen on a phone. The state is still said out loud in the label.
  const micLabel = busy ? "Connecting to voice" : muted ? "Mic off — tap to talk" : "Mic live";
  return (
    <div className="voice-controls" data-testid="voice-controls">
      <button
        type="button"
        className={`icon-button voice-button${!muted && !busy ? " voice-button--live" : ""}`}
        aria-pressed={!muted}
        aria-label={micLabel}
        title={micLabel}
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
        {muted || busy ? <MicOffIcon /> : <MicIcon />}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={stopVoice}
        aria-label="Leave voice"
        title="Leave voice"
        data-testid="voice-leave"
      >
        <LeaveIcon />
      </button>
    </div>
  );
}
