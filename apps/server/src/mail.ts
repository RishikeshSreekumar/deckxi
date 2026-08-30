/**
 * Magic-link delivery (#93).
 *
 * Until now `createAuth` fell back to its dev default — `console.info` the
 * link — in every environment, which in a deployment meant the sign-in link
 * went to the Cloud Run log and the player waited for an email that was never
 * coming. No error, no clue.
 *
 * Provider: **Resend**, over plain `fetch`. Its free tier (3,000 emails a
 * month, 100 a day) is far more than a pre-launch game sends, and the whole
 * integration is one HTTP POST — an SDK would be a dependency, a version to
 * keep and a bundle, to save writing a JSON body.
 *
 * Two rules, both about not lying to the player:
 *
 *  1. **Locally**, with no key, the link still goes to the log. That is a
 *     working dev flow, not a silent failure — you can read it.
 *  2. **In a deployment**, a missing key is an error, and a provider rejection
 *     is an error. Better-auth propagates it, the sign-in request fails, and
 *     the UI says so. A button that appears to work and does nothing is worse
 *     than a button that says it failed.
 */
import type { MagicLinkMail } from "./auth.js";
import type { Logger } from "./logging.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface MailConfig {
  apiKey: string | undefined;
  /** Verified sender, e.g. "DeckXI <play@deckxi.rishikeshs.dev>". */
  from: string | undefined;
  /** Deployments must not fall back to logging the link. */
  isDeployment: boolean;
  log: Logger;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("email delivery is not configured on this server");
    this.name = "MailNotConfiguredError";
  }
}

export function subjectFor(): string {
  return "Your DeckXI sign-in link";
}

/** Plain text as well as HTML: a link is exactly the thing spam filters and
 *  text-only clients need to see intact. */
export function bodyFor(url: string): { html: string; text: string } {
  return {
    text: `Sign in to DeckXI:\n\n${url}\n\nThe link is single-use and expires shortly. If you didn't ask for it, ignore this email.`,
    html: `<p>Sign in to DeckXI:</p><p><a href="${url}">${url}</a></p><p>The link is single-use and expires shortly. If you didn't ask for it, ignore this email.</p>`,
  };
}

/**
 * Build the delivery hook better-auth calls. Returns `undefined` when the
 * server should keep the dev default (local, no key configured) — the caller
 * then simply doesn't pass a hook.
 */
export function createMagicLinkSender(
  config: MailConfig,
): ((mail: MagicLinkMail) => Promise<void>) | undefined {
  const send = config.fetchImpl ?? fetch;
  const configured = config.apiKey !== undefined && config.from !== undefined;

  if (!configured && !config.isDeployment) return undefined;

  if (!configured) {
    // Deployed without mail: fail every attempt loudly rather than logging
    // the link where the player will never see it.
    config.log.error(
      { event: "mail.not_configured" },
      "MAIL_API_KEY/MAIL_FROM unset: magic-link sign-in will fail",
    );
    return () => Promise.reject(new MailNotConfiguredError());
  }

  return async (mail: MagicLinkMail): Promise<void> => {
    const { html, text } = bodyFor(mail.url);
    const response = await send(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [mail.email],
        subject: subjectFor(),
        html,
        text,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      config.log.error(
        { event: "mail.send_failed", status: response.status, detail },
        "magic link not delivered",
      );
      // Thrown, not swallowed: the sign-in request must fail so the player is
      // told, instead of waiting for an email that isn't coming.
      throw new Error(`mail provider rejected the send (${response.status})`);
    }

    // The address itself is never logged — the point of the line is that a
    // send happened and can be correlated with the sign-in attempt.
    config.log.info({ event: "mail.sent", kind: "magic-link" }, "magic link sent");
  };
}
