/**
 * better-auth client. Every visitor gets a persistent guest session (cookie)
 * with a generated cricket handle; signing in with Google or a magic link
 * upgrades the guest in place — match history and stats carry over.
 */
import { createAuthClient } from "better-auth/react";
import { anonymousClient, magicLinkClient } from "better-auth/client/plugins";
import { API_URL } from "./socket.js";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [anonymousClient(), magicLinkClient()],
  fetchOptions: { credentials: "include" },
});

/**
 * Guarantee an identity before the socket connects: reuse the session cookie
 * if there is one, otherwise mint a guest. Never throws — an unreachable
 * server just means the socket will retry as an anonymous one-off.
 */
let inFlight: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  // Single-flight: boot and the landing screen both call this; racing two
  // anonymous sign-ins would mint two different guests.
  inFlight ??= (async () => {
    try {
      const { data } = await authClient.getSession();
      if (data === null) await authClient.signIn.anonymous();
    } catch {
      /* offline / server down — the socket layer handles reconnection UX */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
