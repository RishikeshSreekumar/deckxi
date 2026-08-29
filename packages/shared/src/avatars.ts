/**
 * The avatar set — card-art-style tiles players pick from on their profile.
 * Stored as an id in `user.image`; anything else in that column (e.g. an
 * OAuth photo URL) is rendered as a plain image by the client.
 */
export interface AvatarDefinition {
  id: string;
  emoji: string;
  /** Tile background hue (deg) so each avatar reads as its own card. */
  hue: number;
  label: string;
}

export const AVATARS: readonly AvatarDefinition[] = [
  { id: "avatar-bat", emoji: "🏏", hue: 145, label: "The Blade" },
  { id: "avatar-ball", emoji: "🔴", hue: 356, label: "New Cherry" },
  { id: "avatar-gloves", emoji: "🧤", hue: 32, label: "Safe Hands" },
  { id: "avatar-helmet", emoji: "🪖", hue: 210, label: "Lid On" },
  { id: "avatar-trophy", emoji: "🏆", hue: 45, label: "Silverware" },
  { id: "avatar-star", emoji: "⭐", hue: 50, label: "Star Turn" },
  { id: "avatar-fire", emoji: "🔥", hue: 18, label: "On Fire" },
  { id: "avatar-bolt", emoji: "⚡", hue: 55, label: "Quick Single" },
  { id: "avatar-tiger", emoji: "🐯", hue: 28, label: "The Tiger" },
  { id: "avatar-lion", emoji: "🦁", hue: 38, label: "The Lion" },
  { id: "avatar-eagle", emoji: "🦅", hue: 200, label: "Hawk-Eye" },
  { id: "avatar-duck", emoji: "🦆", hue: 90, label: "Golden Duck" },
  { id: "avatar-sun", emoji: "🌞", hue: 48, label: "Day Five" },
  { id: "avatar-moon", emoji: "🌙", hue: 250, label: "Day-Nighter" },
  { id: "avatar-wave", emoji: "🌊", hue: 195, label: "The Sweep" },
  { id: "avatar-mountain", emoji: "⛰️", hue: 160, label: "The Wall" },
] as const;

export function isAvatarId(id: string): boolean {
  return AVATARS.some((a) => a.id === id);
}
