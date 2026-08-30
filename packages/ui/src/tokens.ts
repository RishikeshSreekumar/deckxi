/**
 * Typed mirror of the design tokens in styles.css — for code that needs
 * token values outside CSS (canvas, exports, inline SVG). CSS custom
 * properties remain the source of truth for themed colors; only
 * theme-invariant scales and the theme palettes are mirrored here.
 */

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;

export const radius = { xs: 6, sm: 8, md: 10, base: 14, pill: 999 } as const;

export const duration = { fast: 150, med: 300, slow: 500 } as const;

export const easing = {
  out: "cubic-bezier(0.25, 0.8, 0.4, 1)",
  spring: "cubic-bezier(0.2, 0.7, 0.3, 1.1)",
} as const;

export interface Palette {
  bg: string;
  bgRaised: string;
  bgPanel: string;
  line: string;
  text: string;
  textDim: string;
  accent: string;
  accentStrong: string;
  onAccent: string;
  gold: string;
  danger: string;
  win: string;
}

export const darkPalette: Palette = {
  bg: "#0b1220",
  bgRaised: "#131c30",
  bgPanel: "#16213a",
  line: "#24304d",
  text: "#e8edf7",
  textDim: "#93a1bd",
  accent: "#38bdf8",
  accentStrong: "#0ea5e9",
  onAccent: "#04121f",
  gold: "#fbbf24",
  danger: "#f87171",
  win: "#4ade80",
};

export const lightPalette: Palette = {
  bg: "#eef2f9",
  bgRaised: "#ffffff",
  bgPanel: "#f7f9fe",
  line: "#cdd7e8",
  text: "#16213a",
  textDim: "#5a6a8a",
  accent: "#0284c7",
  accentStrong: "#0369a1",
  onAccent: "#ffffff",
  gold: "#b45309",
  danger: "#dc2626",
  win: "#15803d",
};

export type ThemeName = "dark" | "light";

export const palettes: Record<ThemeName, Palette> = {
  dark: darkPalette,
  light: lightPalette,
};
