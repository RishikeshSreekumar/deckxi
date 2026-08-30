/**
 * Modal primitive: bottom sheet on phones, centered card from --bp-md up.
 * Closes on backdrop click, Escape, and — on the sheet — a downward drag.
 * Focuses itself on open so keyboard users land inside.
 *
 * The drag is an accelerator, never the only way out: Escape, the backdrop
 * and whatever close control the caller renders all still work. A gesture
 * nobody can discover is not an affordance.
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

/** Past this many px of downward drag, releasing dismisses the sheet. */
const DISMISS_PX = 96;

export function Dialog({
  title,
  onClose,
  children,
}: {
  /** Accessible name; rendered as a heading when non-empty. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only drag from the top of the sheet, and only when it is scrolled to
    // the top — otherwise a flick meant for the content dismisses the sheet.
    const el = ref.current;
    if (e.pointerType === "mouse" || el === null || el.scrollTop > 0) return;
    if (e.clientY - el.getBoundingClientRect().top > 44) return;
    dragFrom.current = e.clientY;
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null) return;
    setDragY(Math.max(0, e.clientY - dragFrom.current));
  };

  const onPointerUp = () => {
    if (dragFrom.current === null) return;
    const dismissed = dragY > DISMISS_PX;
    dragFrom.current = null;
    setDragY(0);
    if (dismissed) onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {title !== "" && <h2 className="dialog-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
