/**
 * Voice ICE configuration (#89).
 *
 * STUN is free and gets most peers connected. TURN is not optional: a
 * meaningful share of players sit behind symmetric NAT and will never form a
 * peer connection without a relay, and "voice works for some of my friends"
 * is the worst possible version of this feature.
 *
 * Credentials follow coturn's REST convention, which every hosted TURN
 * provider implements: the username is `<expiry-unix>:<user>` and the password
 * is the base64 HMAC-SHA1 of that username under a shared secret. Nothing is
 * stored, nothing is provisioned per player, and a leaked credential expires
 * on its own within the hour.
 *
 * With no TURN configured this returns STUN alone. Voice then works on most
 * networks and silently fails on some — the client says so rather than
 * pretending the call is still connecting.
 */
import { createHmac } from "node:crypto";

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnConfig {
  /** e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349` */
  urls: string[];
  secret: string;
  /** How long an issued credential lasts. Short: it is only used to connect. */
  ttlSeconds?: number;
}

/** Google's public STUN servers — the conventional free default. */
export const DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

export const DEFAULT_TURN_TTL_SECONDS = 60 * 60;

/**
 * The ICE servers one player should use. `userId` only namespaces the
 * credential — TURN never learns anything about the account beyond this id,
 * and the id is already public at the table.
 */
export function iceServers(
  userId: string,
  turn: TurnConfig | null,
  now: number = Date.now(),
): IceServer[] {
  const servers: IceServer[] = [{ urls: [...DEFAULT_STUN] }];
  if (turn === null || turn.urls.length === 0) return servers;

  const ttl = turn.ttlSeconds ?? DEFAULT_TURN_TTL_SECONDS;
  const expiry = Math.floor(now / 1000) + ttl;
  const username = `${expiry}:${userId}`;
  const credential = createHmac("sha1", turn.secret).update(username).digest("base64");
  servers.push({ urls: [...turn.urls], username, credential });
  return servers;
}

/** Parse the comma-separated `TURN_URLS` env value. */
export function parseTurnUrls(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}
