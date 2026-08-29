/**
 * Sound design pass — tiny synthesized cues via WebAudio (no assets to load).
 * Deal, flip, your-turn nudge, round win/lose, game win/lose, tick. Mutable,
 * persisted, and silent until the first user gesture unlocks the context.
 */
import { loadMuted, saveMuted } from "./session.js";

let ctx: AudioContext | null = null;
let muted = loadMuted();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  saveMuted(value);
}

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface Note {
  freq: number;
  at: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]): void {
  if (muted) return;
  const ac = audio();
  if (ac === null) return;
  const now = ac.currentTime;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = n.type ?? "triangle";
    osc.frequency.value = n.freq;
    const start = now + n.at;
    const peak = n.gain ?? 0.08;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + n.duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + n.duration + 0.05);
  }
}

export const sounds = {
  deal(): void {
    play(
      Array.from({ length: 4 }, (_, i) => ({
        freq: 220 + i * 40,
        at: i * 0.07,
        duration: 0.08,
        type: "square" as const,
        gain: 0.03,
      })),
    );
  },
  flip(): void {
    play([
      { freq: 660, at: 0, duration: 0.06, gain: 0.05 },
      { freq: 880, at: 0.05, duration: 0.08, gain: 0.05 },
    ]);
  },
  yourTurn(): void {
    play([
      { freq: 523, at: 0, duration: 0.12 },
      { freq: 784, at: 0.12, duration: 0.18 },
    ]);
  },
  roundWin(): void {
    play([
      { freq: 523, at: 0, duration: 0.1 },
      { freq: 659, at: 0.09, duration: 0.1 },
      { freq: 784, at: 0.18, duration: 0.2 },
    ]);
  },
  roundLose(): void {
    play([
      { freq: 330, at: 0, duration: 0.12, type: "sine" },
      { freq: 262, at: 0.12, duration: 0.2, type: "sine" },
    ]);
  },
  tie(): void {
    play([{ freq: 440, at: 0, duration: 0.25, type: "sine", gain: 0.05 }]);
  },
  gameWin(): void {
    play([
      { freq: 523, at: 0, duration: 0.15 },
      { freq: 659, at: 0.14, duration: 0.15 },
      { freq: 784, at: 0.28, duration: 0.15 },
      { freq: 1047, at: 0.42, duration: 0.4 },
    ]);
  },
  gameLose(): void {
    play([
      { freq: 392, at: 0, duration: 0.2, type: "sine" },
      { freq: 330, at: 0.2, duration: 0.2, type: "sine" },
      { freq: 262, at: 0.4, duration: 0.4, type: "sine" },
    ]);
  },
  tick(): void {
    play([{ freq: 1200, at: 0, duration: 0.03, type: "square", gain: 0.02 }]);
  },
};
