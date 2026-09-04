/**
 * @deckxi/ui — design system: tokens, the TrumpCard renderer and the core
 * component kit. Import "@deckxi/ui/styles.css" for tokens + kit styles.
 */
export * as tokens from "./tokens.js";
export {
  getEdition,
  getCardInfo,
  registerEdition,
  statName,
  formatStatValue,
  DEFAULT_EDITION_ID,
  type CardInfo,
} from "./editions.js";
export { TrumpCard, type TrumpCardProps, type CardSize } from "./TrumpCard.js";
export { PowerCard, type PowerCardProps } from "./PowerCard.js";
export { CardBackArt, RoleIcon, RolePortrait } from "./cardArt.js";
export { Avatar } from "./Avatar.js";
export { TimerRing } from "./TimerRing.js";
export { Dialog } from "./Dialog.js";
export { RoomCode } from "./RoomCode.js";
