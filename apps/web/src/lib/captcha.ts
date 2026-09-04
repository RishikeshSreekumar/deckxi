/**
 * Cloudflare Turnstile, loaded only when the server asks for it (#87).
 *
 * Nobody sees a challenge on the way into a game. The server counts wrong
 * join codes per source and, once a client looks like it is sweeping the
 * code space, answers `captcha-required`; only then does any of this load.
 * That keeps the widget's script off the critical path for every real player
 * — which is the whole reason the challenge is conditional in the first place.
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Configured per deployment; unset means this build cannot answer a challenge. */
export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env["VITE_TURNSTILE_SITE_KEY"] as
  string | undefined;

interface Turnstile {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ): string;
  remove(widgetId: string): void;
}

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const existing = (globalThis as { turnstile?: Turnstile }).turnstile;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = (globalThis as { turnstile?: Turnstile }).turnstile;
      if (api === undefined) reject(new Error("Turnstile loaded without an API"));
      else resolve(api);
    };
    script.onerror = () => {
      // Reset so a later attempt can retry rather than inheriting a rejection.
      loading = null;
      reject(new Error("Couldn't load the challenge."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Render a challenge into `container` and resolve with its token. Rejects if
 * the widget errors, expires, or the build has no site key — every one of
 * which the caller shows as "we couldn't verify you, try again".
 */
export async function solveCaptcha(container: HTMLElement): Promise<string> {
  if (TURNSTILE_SITE_KEY === undefined || TURNSTILE_SITE_KEY === "") {
    throw new Error("No challenge is configured for this build.");
  }
  const turnstile = await loadTurnstile();
  return await new Promise<string>((resolve, reject) => {
    const id = turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "auto",
      callback: (token) => {
        turnstile.remove(id);
        resolve(token);
      },
      "error-callback": () => {
        turnstile.remove(id);
        reject(new Error("The challenge failed. Try again."));
      },
      "expired-callback": () => {
        turnstile.remove(id);
        reject(new Error("The challenge expired. Try again."));
      },
    });
  });
}
