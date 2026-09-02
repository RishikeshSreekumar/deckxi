/**
 * Theme preference (#98).
 *
 * The OS decides by default — the generated token CSS answers
 * `prefers-color-scheme` on its own, so the correct theme paints before any
 * JavaScript runs and there is no flash. An explicit choice wins in both
 * directions via `data-theme` on <html> and persists to localStorage.
 *
 * The only thing that genuinely needs JS is `<meta name="theme-color">`: it
 * tints the browser and PWA status bar, and it cannot follow a class the way
 * CSS can. index.html carries a media-scoped pair for the pre-JS paint; once
 * we boot, this module owns the tag.
 */
import { useSyncExternalStore } from "react";
import { tokens } from "@deckxi/ui";

type ThemeName = tokens.ThemeName;

/** "system" defers to the OS; the others are an explicit user choice. */
export type ThemePreference = "system" | ThemeName;

const STORAGE_KEY = "deckxi.theme";
const listeners = new Set<() => void>();

let preference: ThemePreference = "system";

/** The stored choice, kept for when the toggle returns; unused while pinned. */
export function readStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    // Private mode / blocked storage — fall back to the OS preference.
    return "system";
  }
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme actually on screen, after the preference resolves. */
export function resolveTheme(pref: ThemePreference): ThemeName {
  if (pref !== "system") return pref;
  return typeof window === "undefined" || prefersDark() ? "dark" : "light";
}

function apply(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = pref;

  // Replace whatever is there — including index.html's media-scoped pair —
  // with a single tag for the theme actually showing.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = tokens.palettes[resolveTheme(pref)].surfaceBase;
  document.head.appendChild(meta);
}

export function setThemePreference(pref: ThemePreference): void {
  preference = pref;
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Preference is still applied for this session; it just will not persist.
  }
  apply(pref);
  for (const listener of listeners) listener();
}

/**
 * Call once at boot, before first paint of the app tree.
 *
 * Pinned to light for now: the dark palette is parked until the redesign
 * settles, so the OS preference and any stored choice are ignored. The
 * preference plumbing stays so the toggle can come back without a rewrite.
 */
export function initTheme(): void {
  preference = "light";
  apply(preference);
  // While on "system", follow the OS if it changes mid-session.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (preference === "system") {
      apply(preference);
      for (const listener of listeners) listener();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): {
  preference: ThemePreference;
  theme: ThemeName;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
} {
  const pref = useSyncExternalStore(
    subscribe,
    () => preference,
    () => "system" as ThemePreference,
  );
  const theme = resolveTheme(pref);
  return {
    preference: pref,
    theme,
    setPreference: setThemePreference,
    // A two-state flip from whatever is on screen. Cycling through "system"
    // would make the control's next state unguessable, which is the one thing
    // a theme toggle must never be.
    toggle: () => setThemePreference(theme === "dark" ? "light" : "dark"),
  };
}
