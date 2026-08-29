/**
 * Identity — better-auth wired for DeckXI:
 *  - anonymous plugin: every visitor gets a persistent guest account with a
 *    generated cricket handle (zero-signup play)
 *  - Google OAuth (when configured) + email magic link as the upgrade paths;
 *    linking migrates the guest's match history to the new account
 *  - user deletion enabled; deleting scrubs the user's match rows
 *
 * Backed by Drizzle/Postgres when DATABASE_URL is set, otherwise an in-memory
 * adapter (dev and tests need no database).
 */
import type { IncomingHttpHeaders } from "node:http";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { anonymous } from "better-auth/plugins/anonymous";
import { magicLink } from "better-auth/plugins/magic-link";
import type { MatchStore } from "./store.js";
import { generateGuestHandle, randomAvatarId } from "./handles.js";
import { account, session, user, verification } from "./db/auth-schema.js";

export interface MagicLinkMail {
  email: string;
  url: string;
  token: string;
}

export interface AuthConfig {
  /** Postgres for real deployments; omit for the in-memory adapter. */
  databaseUrl?: string | undefined;
  secret: string;
  /** The server's own public URL (better-auth builds callback URLs from it). */
  baseURL: string;
  /** Web origins allowed to drive auth flows (CSRF allowlist). */
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string } | undefined;
  /** Delivery hook for magic links; dev default logs the URL to stdout. */
  sendMagicLink?: (mail: MagicLinkMail) => void | Promise<void>;
  /** Match store, so identity changes propagate into match history. */
  store: MatchStore;
}

export type Auth = ReturnType<typeof buildAuthInstance>;

export interface AuthBundle {
  auth: Auth;
  close(): Promise<void>;
}

export function createAuth(config: AuthConfig): AuthBundle {
  let pool: pg.Pool | null = null;
  let database;
  if (config.databaseUrl !== undefined) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
    database = drizzleAdapter(drizzle(pool), {
      provider: "pg",
      schema: { user, session, account, verification },
    });
  } else {
    // Pre-register every model — the adapter throws on models it hasn't seen.
    database = memoryAdapter({ user: [], session: [], account: [], verification: [] });
  }

  return {
    auth: buildAuthInstance(config, database),
    async close() {
      await pool?.end();
    },
  };
}

function buildAuthInstance(
  config: AuthConfig,
  database: ReturnType<typeof drizzleAdapter> | ReturnType<typeof memoryAdapter>,
) {
  const sendMagicLink =
    config.sendMagicLink ??
    ((mail: MagicLinkMail) => {
      // No mail provider configured (dev): the link lands in the server log.
      console.info(`[auth] magic link for ${mail.email}: ${mail.url}`);
    });

  return betterAuth({
    baseURL: config.baseURL,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database,
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (deleted) => {
          await config.store.anonymizeUser(deleted.id);
        },
      },
    },
    ...(config.google !== undefined
      ? {
          socialProviders: {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
            },
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          // New guests get a random avatar from the shared set.
          before: (data) => {
            const isAnonymous = (data as { isAnonymous?: boolean }).isAnonymous === true;
            if (!isAnonymous || data.image != null) return Promise.resolve({ data });
            return Promise.resolve({ data: { ...data, image: randomAvatarId() } });
          },
        },
      },
    },
    plugins: [
      anonymous({
        generateName: () => generateGuestHandle(),
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          // Guest→account upgrade: the guest's matches now belong to the account.
          await config.store.reassignUser(anonymousUser.user.id, newUser.user.id);
        },
      }),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          await sendMagicLink({ email, url, token });
        },
      }),
    ],
  });
}

/** Node request headers → fetch Headers (what better-auth's API expects). */
export function toWebHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return headers;
}

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAnonymous: boolean;
}

/** Resolve the signed-in user from request headers; null when signed out. */
export async function userFromHeaders(
  auth: Auth,
  raw: IncomingHttpHeaders,
): Promise<AuthedUser | null> {
  const result = await auth.api.getSession({ headers: toWebHeaders(raw) });
  if (result === null) return null;
  const u = result.user as typeof result.user & { isAnonymous?: boolean | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    isAnonymous: u.isAnonymous === true,
  };
}
