/**
 * Environment parsing — fail fast and loudly on a bad config.
 */
import { z } from "zod";
import { parseOrigins } from "./origins.js";

/** Which deployment this process is: local dev, staging, or production. */
export type AppEnv = "development" | "staging" | "production";

const envSchema = z.object({
  /** Deployment tier. Staging and production are held to the same rules. */
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  /** Optional in dev — without it match persistence is in-memory. */
  DATABASE_URL: z.string().url().optional(),
  /**
   * Comma-separated allowed web origins for CORS / websocket upgrades. A
   * leading `*` label is allowed for preview deploys
   * (`https://*.deckxi-web.pages.dev`). Required outside dev.
   */
  CORS_ORIGINS: z.string().optional(),
  /** Session signing secret; required outside local dev. */
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  /** The server's public URL (OAuth/magic-link callbacks build on it). */
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** pino level; `debug` locally when chasing something, `info` deployed. */
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  /** Build identifier (git sha) stamped on every log line and error report. */
  RELEASE: z.string().optional(),
  /** Bearer token for /metrics and the admin API; unset means loopback only. */
  ADMIN_TOKEN: z.string().min(16).optional(),
  /** Comma-separated account emails allowed into /admin. Unset means nobody. */
  ADMIN_EMAILS: z.string().optional(),
  /** Resend API key for magic-link email (#93); unset logs the link in dev. */
  MAIL_API_KEY: z.string().optional(),
  /** Verified sender, e.g. "DeckXI <play@deckxi.rishikeshs.dev>". */
  MAIL_FROM: z.string().optional(),
  /** Cloud Run sets this per revision; a usable release id when RELEASE isn't set. */
  K_REVISION: z.string().optional(),
  /**
   * Cloudflare Turnstile secret (#87). Unset means sources that trip the
   * abuse quotas are refused outright instead of being offered a challenge.
   */
  TURNSTILE_SECRET: z.string().min(8).optional(),
  /**
   * Redis for multi-instance operation (#86): the room directory and the
   * instance-to-instance bus. Unset means a cluster of one, which is what a
   * single Cloud Run instance is.
   */
  REDIS_URL: z.string().url().optional(),
});

export interface Env {
  appEnv: AppEnv;
  port: number;
  host: string;
  databaseUrl: string | undefined;
  corsOrigins: string[];
  authSecret: string | undefined;
  authUrl: string | undefined;
  google: { clientId: string; clientSecret: string } | undefined;
  logLevel: string;
  release: string | undefined;
  adminToken: string | undefined;
  adminEmails: string[];
  mail: { apiKey: string | undefined; from: string | undefined };
  captchaSecret: string | undefined;
  redisUrl: string | undefined;
}

/**
 * A deployed server must not fall back to dev defaults: a missing database,
 * a dev session secret or a localhost origin allowlist would each be a
 * silent production bug, so refuse to boot instead.
 */
function requiredInDeployment(parsed: z.infer<typeof envSchema>): string[] {
  if (parsed.APP_ENV === "development") return [];
  const missing: string[] = [];
  if (parsed.DATABASE_URL === undefined) missing.push("DATABASE_URL");
  if (parsed.BETTER_AUTH_SECRET === undefined) missing.push("BETTER_AUTH_SECRET");
  if (parsed.BETTER_AUTH_URL === undefined) missing.push("BETTER_AUTH_URL");
  if (parsed.CORS_ORIGINS === undefined) missing.push("CORS_ORIGINS");
  return missing;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  const missing = requiredInDeployment(parsed);
  if (missing.length > 0) {
    throw new Error(`APP_ENV=${parsed.APP_ENV} requires: ${missing.join(", ")}`);
  }
  return {
    appEnv: parsed.APP_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    corsOrigins: parseOrigins(parsed.CORS_ORIGINS ?? "http://localhost:5173"),
    authSecret: parsed.BETTER_AUTH_SECRET,
    authUrl: parsed.BETTER_AUTH_URL,
    google:
      parsed.GOOGLE_CLIENT_ID !== undefined && parsed.GOOGLE_CLIENT_SECRET !== undefined
        ? { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET }
        : undefined,
    logLevel: parsed.LOG_LEVEL ?? (parsed.APP_ENV === "development" ? "debug" : "info"),
    release: parsed.RELEASE ?? parsed.K_REVISION,
    adminToken: parsed.ADMIN_TOKEN,
    adminEmails: (parsed.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0),
    mail: { apiKey: parsed.MAIL_API_KEY, from: parsed.MAIL_FROM },
    captchaSecret: parsed.TURNSTILE_SECRET,
    redisUrl: parsed.REDIS_URL,
  };
}
