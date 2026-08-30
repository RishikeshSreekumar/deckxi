/**
 * Countdown ring for the turn timer, driven by the server deadline so clock
 * drift only affects the picture, never the rules. Sound-agnostic: the app
 * passes `onTick` to beep on the final seconds.
 */
import { useEffect, useState } from "react";

export function TimerRing({
  deadline,
  seconds,
  onTick,
}: {
  deadline: number;
  seconds: number;
  /** Called once per second change while ≤5s remain (for tick sounds). */
  onTick?: (secondsLeft: number) => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    let last = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
    const tick = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now());
      setRemaining(ms);
      const s = Math.ceil(ms / 1000);
      if (s !== last && s <= 5 && s > 0) onTick?.(s);
      last = s;
    }, 100);
    return () => clearInterval(tick);
  }, [deadline, onTick]);

  const total = seconds * 1000;
  const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
  const r = 16;
  const circumference = 2 * Math.PI * r;
  const secondsLeft = Math.ceil(remaining / 1000);

  return (
    <div className={`timer-ring ${secondsLeft <= 5 ? "timer-ring--urgent" : ""}`} role="timer">
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3" className="timer-track" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="3"
          className="timer-arc"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="timer-label">{secondsLeft}</span>
    </div>
  );
}
