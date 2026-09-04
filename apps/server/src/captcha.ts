/**
 * CAPTCHA on abuse signals (#87) — Cloudflare Turnstile.
 *
 * Deliberately *not* a gate everyone walks through. A join code arrives by
 * WhatsApp and gets tapped in on a phone; putting a challenge in front of that
 * would cost us more players than it saves. So the challenge appears only for
 * a source the quota layer already thinks is a script (`Quotas.suspicious`),
 * and only when a secret is configured. Unconfigured, the server simply
 * refuses the over-quota request — the same answer, one step blunter.
 *
 * Turnstile because it needs no account linkage and has a free tier; the
 * verify call is one POST and the shape below is all of its contract we use.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface CaptchaVerifier {
  /** True when the token is good for this client. */
  verify(token: string, ip: string): Promise<boolean>;
}

export interface TurnstileOptions {
  secret: string;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function turnstileVerifier(options: TurnstileOptions): CaptchaVerifier {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  return {
    async verify(token, ip) {
      if (token.trim() === "") return false;
      const body = new URLSearchParams({ secret: options.secret, response: token });
      if (ip !== "unknown") body.set("remoteip", ip);
      const abort = AbortSignal.timeout(timeoutMs);
      try {
        const response = await doFetch(VERIFY_URL, { method: "POST", body, signal: abort });
        if (!response.ok) return false;
        const result = (await response.json()) as { success?: boolean };
        return result.success === true;
      } catch {
        // Cloudflare unreachable. Fail *closed*: this path is only reached by
        // a source we already believe is a script, and letting it through
        // because a third party is down is how a rate limit becomes optional.
        return false;
      }
    },
  };
}
