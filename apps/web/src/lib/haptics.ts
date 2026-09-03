/**
 * Haptics — short Vibration API pulses on the moments a player's thumb is
 * already on the glass: the stat they just called, the verdict, the nudge
 * that it is their turn.
 *
 * Gated three ways, in order:
 *   1. Capability: `navigator.vibrate` is Chromium-only (Android). iOS Safari
 *      has never shipped it, so every call there is a silent no-op.
 *   2. The device setting, persisted alongside sounds. Off is remembered.
 *   3. `prefers-reduced-motion` — a buzz is motion the player has asked not
 *      to have.
 *
 * No pattern runs longer than 60ms. A phone that buzzes like a notification
 * every round reads as a bug, not as feedback.
 */
import { loadHaptics, saveHaptics } from "./session.js";

let enabled = loadHaptics();

/** True where the platform can vibrate at all — drives whether the setting is shown. */
export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
  saveHaptics(value);
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pulse(pattern: number | number[]): void {
  if (!enabled || !hapticsSupported() || reducedMotion()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some embedded browsers expose the function and then throw */
  }
}

export const haptics = {
  /** A stat was called, an emote sent — the tap landed. */
  tap(): void {
    pulse(10);
  },
  /** It is your turn: two light beats, distinct from a single tap. */
  yourTurn(): void {
    pulse([15, 40, 15]);
  },
  /** Round taken. One firm beat. */
  win(): void {
    pulse(30);
  },
  /** Round lost or tied. Softer than a win so the two are told apart blind. */
  lose(): void {
    pulse(12);
  },
};
