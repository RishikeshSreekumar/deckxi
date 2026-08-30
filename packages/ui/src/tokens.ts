/**
 * Public token surface for @deckxi/ui.
 *
 * Values are generated — edit `tokens/tokens.json` and run
 * `pnpm --filter @deckxi/ui tokens`. This file exists so the public API is a
 * deliberate choice rather than whatever the generator happened to emit.
 */
export {
  primitiveColors,
  space,
  radius,
  duration,
  easing,
  breakpoint,
  container,
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight,
  tracking,
  touchMin,
  darkPalette,
  lightPalette,
  palettes,
  type Palette,
  type ThemeName,
} from "./generated/tokens.js";
