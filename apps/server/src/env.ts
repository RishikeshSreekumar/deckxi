/**
 * Environment parsing — fail fast and loudly on a bad config.
 */
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  /** Optional until Phase 7 — without it match persistence is in-memory. */
  DATABASE_URL: z.string().url().optional(),
  /** Comma-separated allowed web origins for CORS / websocket upgrades. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  /** Session signing secret; required outside local dev. */
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  /** The server's public URL (OAuth/magic-link callbacks build on it). */
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export interface Env {
  port: number;
  host: string;
  databaseUrl: string | undefined;
  corsOrigins: string[];
  authSecret: string | undefined;
  authUrl: string | undefined;
  google: { clientId: string; clientSecret: string } | undefined;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    authSecret: parsed.BETTER_AUTH_SECRET,
    authUrl: parsed.BETTER_AUTH_URL,
    google:
      parsed.GOOGLE_CLIENT_ID !== undefined && parsed.GOOGLE_CLIENT_SECRET !== undefined
        ? { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET }
        : undefined,
  };
}
