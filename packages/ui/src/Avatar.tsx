/**
 * Player avatar: an id from the shared card-art-style set renders as an emoji
 * tile; anything else (an OAuth photo URL) renders as an image; no avatar
 * falls back to the name's initial.
 */
import { AVATARS } from "@deckxi/shared";

export function Avatar({
  image,
  name,
  size = 40,
}: {
  image: string | null;
  name: string;
  size?: number;
}) {
  const preset = image !== null ? AVATARS.find((a) => a.id === image) : undefined;
  const style = { width: size, height: size, fontSize: size * 0.55 };
  if (preset !== undefined) {
    return (
      <span
        className="avatar"
        // Light and saturated, because the tile now carries ink type and an
        // ink outline: the old 24%-lightness fill was built for white-on-dark.
        style={{ ...style, background: `hsl(${preset.hue} 68% 62%)` }}
        role="img"
        aria-label={preset.label}
      >
        {preset.emoji}
      </span>
    );
  }
  if (image !== null && image.startsWith("http")) {
    return (
      <img className="avatar" style={style} src={image} alt={name} referrerPolicy="no-referrer" />
    );
  }
  return (
    <span className="avatar" style={style} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
