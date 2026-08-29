/**
 * @deckxi/server — Fastify + Socket.IO realtime game server (authoritative).
 */
import { APP_NAME, PROTOCOL_VERSION } from "@deckxi/shared";

export function serverInfo(): string {
  return `${APP_NAME} server (protocol v${PROTOCOL_VERSION})`;
}
