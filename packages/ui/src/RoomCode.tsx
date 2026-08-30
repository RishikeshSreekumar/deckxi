/**
 * Room join code as big tappable-looking characters.
 */
export function RoomCode({ code }: { code: string }) {
  return (
    <div className="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
      {code.split("").map((c, i) => (
        <span key={i} className="code-char">
          {c}
        </span>
      ))}
    </div>
  );
}
