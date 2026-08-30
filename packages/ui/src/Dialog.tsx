/**
 * Modal primitive: bottom sheet on mobile, centered card from 720px up.
 * Closes on backdrop click and Escape; focuses itself on open so keyboard
 * users land inside.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

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

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== "" && <h2 className="dialog-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
