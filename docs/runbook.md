# Deploy runbook

## Where things run

Pre-launch, only **staging** exists, and every piece of it sits on a free tier —
not on GCP trial credits, which expire. Domain: `deckxi.rishikeshs.dev`.

| Piece    | Staging (live now)                                         | Cost   |
| -------- | ---------------------------------------------------------- | ------ |
| Web      | Cloudflare Pages `deckxi-web`, branch `main`               | free   |
|          | `https://staging.deckxi.rishikeshs.dev`                    |        |
| API      | Cloud Run `deckxi-api-staging` (`deploy-api-cloudrun.yml`) | free\* |
|          | `https://api-staging.deckxi.rishikeshs.dev`                |        |
| Database | Neon branch `staging`                                      | free   |

\* Cloud Run's always-free tier is 2M requests, 180k vCPU-seconds and 360k
GiB-seconds per month. One instance capped at 1 vCPU covers roughly 50 hours of
active play per month before anything is billable, and it scales to zero when
idle. Artifact Registry gives 0.5 GB free, which is why the repo has a cleanup
policy keeping the last few images.

**Production is not provisioned.** At launch, pick a target and provision it:

- **Stay on Cloud Run** — nothing to do but create a `production` service and
  point `deploy.yml`'s production job at `deploy-api-cloudrun.yml`.
- **Move to Fly** — `fly.production.toml` and `deploy-api.yml` are already
  written and kept current; see "Migrating the API to Fly" below.

The API is deliberately **one instance per environment** (`--max-instances 1` on
Cloud Run, `max_machines_running = 1` on Fly): rooms live in process memory, so
a second instance would split players across two game states. Do not scale it
out before the Redis adapter (Phase 10, #86).

Two Cloud Run constraints that matter for a realtime game, both survivable
because the server already has reconnect grace and turn timers:

- A request — including a websocket — is capped at **60 minutes**, so a very
  long session gets dropped and has to reconnect.
- Scaling to zero after an idle period ends every room, same as a redeploy.
- The exact path `/healthz` is reserved by Cloud Run's frontend and never
  reaches the container, which is why the health endpoint is served at
  `/health` (`/healthz` stays registered for Fly and local use). To tell the
  two apart: a response carrying `x-cloud-trace-context` came from the app, one
  without it was answered upstream.

## Pipelines

| Trigger         | What runs                                                            |
| --------------- | -------------------------------------------------------------------- |
| Any PR          | `ci.yml` (lint/typecheck/test, image build) + Pages preview deploy   |
| Merge to `main` | `deploy.yml` → migrate staging DB → deploy staging API; web → `main` |
| Tag `v*`        | production jobs — dormant until production is provisioned            |
| Manual          | `deploy.yml` → _Run workflow_ → pick an environment                  |

Migrations always run **before** the new image goes live, as a separate job, so
a failed migration aborts the deploy rather than leaving new code on an old
schema. Keep migrations backwards compatible (add columns nullable, backfill,
drop in a later release) — that's what makes rollback safe.

## One-time setup

### Google Cloud

```sh
gcloud projects create deckxi --name=DeckXI          # or reuse an existing one
gcloud config set project deckxi
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com
gcloud artifacts repositories create deckxi \
  --repository-format=docker --location="$REGION"
```

Billing must be enabled on the project even to use the free tier. Set a budget
alert at a low number (₹100 / $1) — a budget doesn't cap spend, but it tells you
the moment something drifts out of the free tier.

Keep the last few images only, so Artifact Registry stays under its 0.5 GB free
allowance:

```sh
gcloud artifacts repositories set-cleanup-policies deckxi \
  --location="$REGION" --policy=cleanup-policy.json
```

### Where each config value lives

Secret that the running server needs → Secret Manager. Secret that CI needs →
GitHub. Not secret → the workflow, where it shows up in a diff.

| Value                                        | Lives in                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                         | Secret Manager `deckxi-<env>-auth-secret`                                                                                  |
| `GOOGLE_CLIENT_ID`                           | Secret Manager `deckxi-<env>-google-client-id`                                                                             |
| `GOOGLE_CLIENT_SECRET`                       | Secret Manager `deckxi-<env>-google-client-secret`                                                                         |
| `DATABASE_URL`                               | Secret Manager `deckxi-<env>-database-url` **and** the GitHub environment (the migrate job runs in Actions, not Cloud Run) |
| `APP_ENV`, `CORS_ORIGINS`, `BETTER_AUTH_URL` | `deploy.yml` inputs                                                                                                        |

`deploy-api-cloudrun.yml` references those secret names literally, so a typo
surfaces as a container that won't boot rather than a warning.

```sh
for s in database-url auth-secret google-client-id google-client-secret; do
  gcloud secrets create "deckxi-staging-$s" --replication-policy=automatic
done
printf '%s' 'postgres://…?sslmode=verify-full' | \
  gcloud secrets versions add deckxi-staging-database-url --data-file=-
openssl rand -base64 32 | \
  gcloud secrets versions add deckxi-staging-auth-secret --data-file=-
printf '%s' 'YOUR_CLIENT_ID' | \
  gcloud secrets versions add deckxi-staging-google-client-id --data-file=-
printf '%s' 'YOUR_CLIENT_SECRET' | \
  gcloud secrets versions add deckxi-staging-google-client-secret --data-file=-
```

Use `printf`, not `echo`: a trailing newline becomes part of the secret and
shows up much later as an unexplained OAuth rejection.

Rotating a value means adding a **new version and redeploying** — Cloud Run
resolves `:latest` when the container starts, so a running revision keeps the
old value until it restarts.

Google OAuth credentials come from Console → APIs & Services. Configure the
consent screen first (External; while it is in Testing mode only accounts listed
under Test users can sign in), then create a Web application client with
redirect URI `https://api-<env>.deckxi.rishikeshs.dev/api/auth/callback/google`.

### Keyless deploys (Workload Identity Federation)

Rather than pasting a service account JSON key into GitHub, let GitHub's OIDC
token stand in for the service account. Create the pool/provider, restrict it to
this repository, and grant the deployer the roles it needs:

```sh
gcloud iam service-accounts create github-deployer
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition='assertion.repository=="RishikeshSreekumar/deckxi"'
```

Roles on `github-deployer@…`: `roles/run.admin`,
`roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`, and
`roles/secretmanager.secretAccessor` on each secret. Then bind the repo to the
service account with `roles/iam.workloadIdentityUser` on principalSet
`…/attribute.repository/RishikeshSreekumar/deckxi`.

### Neon

Create the project, then a `staging` branch off the default. Branches are
copy-on-write, so staging costs nothing. Take the **pooled** connection string
(host contains `-pooler`) and add `?sslmode=verify-full`. Not `require`: the
`pg` driver currently treats it as an alias for `verify-full` but warns that
pg v9 will downgrade it to weaker libpq semantics, so spelling it out keeps
today's behaviour when that lands.

### GitHub

Environment `staging` (add `production` at launch) holding `DATABASE_URL`.

Repository **variables**: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`
(the full provider resource name), `GCP_SERVICE_ACCOUNT`.

Repository **secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Create the token as a **Custom token** (not one of the templates — the Workers
template grants a pile of unrelated permissions and doesn't cover Pages) with a
single permission: **Account → Cloudflare Pages → Edit**, scoped to your
account. That is everything `wrangler pages deploy` needs, since the workflow
passes the account ID explicitly. Note it is account-scoped, not project-scoped.

### Cloudflare Pages

Project `deckxi-web`, production branch set to **`production`** (so `main`
deploys land on the staging alias, and nothing reaches the public domain until
you tag). Custom domains: `deckxi.rishikeshs.dev` on the project at launch,
`staging.deckxi.rishikeshs.dev` CNAME'd to `main.deckxi-web.pages.dev` now.

### DNS / TLS

Map the API's custom domain so browsers see the API as same-site with the web
app — `*.run.app` is on the Public Suffix List, so the raw Cloud Run URL would
be cross-site and better-auth's session cookie would need `SameSite=None`:

```sh
gcloud beta run domain-mappings create --service deckxi-api-staging \
  --domain api-staging.deckxi.rishikeshs.dev --region "$REGION"
```

This needs the domain verified in Google Search Console (a TXT record). Add the
records it prints to Cloudflare DNS as **DNS-only** (grey cloud). Google issues
and renews the certificate.

**Domain mappings only exist in some regions** — `asia-south1` (Mumbai) is not
one of them, which is why staging runs in `asia-southeast1` (Singapore) despite
the extra ~40 ms. As of writing the supported set is `asia-east1`,
`asia-northeast1`, `asia-southeast1`, `europe-north1`, `europe-west1`,
`europe-west4`, `us-central1`, `us-east1`, `us-east4`, `us-west1`; the create
command fails with `501 UNIMPLEMENTED` anywhere else. Google's suggested
alternatives were both rejected here: a global external Application Load
Balancer costs roughly $18/month, and Firebase Hosting does not proxy
WebSockets, which is the whole transport. Fly has a Mumbai region (`bom`), so
the latency gap closes when production moves there.

Pages handles TLS for the web hostnames itself.

## Deploying

- **Staging:** merge to `main`. Watch the _Deploy_ workflow; it ends with a
  `/health` smoke test.
- **Production:** promote a commit that has been on staging.

  ```sh
  git tag -a v0.3.0 -m "…" && git push origin v0.3.0
  ```

- **Manual:** _Actions → Deploy → Run workflow → environment_.

Verify by hand after a release:

```sh
curl -s https://api-staging.deckxi.rishikeshs.dev/health     # {"ok":true,…}
gcloud run services describe deckxi-api-staging --region "$REGION"
```

Then open the web app, create a room, join it from a second browser, play a
round — the smoke test only proves the process is up, not that websockets are
reaching it through DNS, TLS and the proxy.

## Rollback

Code — Cloud Run keeps every revision, so rollback is a traffic switch with no
rebuild:

```sh
gcloud run revisions list --service deckxi-api-staging --region "$REGION"
gcloud run services update-traffic deckxi-api-staging \
  --region "$REGION" --to-revisions <good-revision>=100
```

On Fly the equivalent is `fly releases rollback -a <app>`. Either way, if you
rolled back production, re-tag the good commit (`v0.3.1`) so `main`'s history
matches what's live — never leave production on an image no tag points at.

Web: Cloudflare Pages → project → _Deployments_ → the previous production
deployment → **Rollback**.

Database: rolling code back is safe only if the migration was backwards
compatible. Otherwise restore, don't reverse:

```sh
# Neon keeps point-in-time history; branch from before the migration
neonctl branches create --name hotfix-restore --parent production@2026-08-30T12:00:00Z
```

Point the app at the restored branch — add a new version to the
`deckxi-<env>-database-url` secret and redeploy (Cloud Run resolves `:latest` at
container start, so a running revision keeps the old value until it restarts) —
confirm, then make it permanent.

## Observability

### Logs

The server writes one JSON object per line to stdout, and that is the entire
log pipeline: Cloud Run ships container stdout to Cloud Logging, which is free
up to 50 GiB a month and keeps 30 days. **No hosted log vendor is wired up on
purpose** — a drain (Better Stack, Axiom, Datadog) is another account, another
key to rotate and another bill to watch, and it buys nothing Cloud Logging
doesn't already give a single-instance server. If one is ever wanted, a Log
Router sink forwards to it without touching the app.

Every line carries `service`, `env`, `release` (the deployed commit sha), a
`severity` Cloud Logging understands, and whichever correlation ids are known
at that point:

| Field       | Present on                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `reqId`     | HTTP requests — reused from `x-request-id` or the Cloud Run trace id, so it joins to the load balancer's own logs |
| `socketId`  | anything a websocket connection did                                                                               |
| `userId`    | the account behind the connection (null for cookie-less clients)                                                  |
| `roomId`    | once the socket has joined a room                                                                                 |
| `sessionId` | the seat inside that room                                                                                         |
| `matchId`   | game start/finish and anything about a running match                                                              |

Follow one game end to end:

```sh
gcloud logging read \
  'resource.labels.service_name="deckxi-api-staging" AND jsonPayload.roomId="<uuid>"' \
  --limit 200 --format='value(timestamp, jsonPayload.event, jsonPayload.message)'
```

Named events worth knowing: `room.created`, `room.joined`, `room.closed`,
`game.started`, `game.finished`, `command.rejected` (a player asked for
something the rules refuse — routine, `debug`), `command.failed` (a handler
threw — never routine), `store.write_failed` (persistence degraded, gameplay
unaffected).

Cookies and `Authorization` headers are redacted before anything is written.

Locally, `LOG_LEVEL=debug` is the default and the lines are raw JSON; pipe
through `pnpm dlx pino-pretty` when reading them by eye.

### Errors

**There is no Sentry**, deliberately. Its free tier costs no money but does
cost ~30 KB gzipped of browser SDK against a payload budget CI enforces, an
account and DSN to keep, and a CI token for source-map upload — to buy grouping
and a UI over a stream of errors that is already structured and queryable here.
Both sides funnel into log lines instead:

| Event                       | Means                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| `error.server`              | a route threw; 5xx only                                                |
| `error.client`              | the browser reported one (`kind`: error, unhandledrejection, boundary) |
| `error.uncaught_exception`  | the process is about to die                                            |
| `error.unhandled_rejection` | a promise rejected with nobody watching                                |
| `command.failed`            | a socket handler threw (a `RoomError` is not this)                     |

```sh
gcloud logging read \
  'resource.labels.service_name="deckxi-api-staging" AND jsonPayload.event:"error."' \
  --limit 50 --freshness=1d
```

Alerting on them is set up with everything else in "Metrics & alerts" below.

The browser posts to `POST /api/telemetry/error`. That endpoint is public, so
it is rate-limited to 10 reports per IP with a slow refill, caps every field,
and answers 204 without a body; the client de-duplicates and stops at 10
reports per session. Neither side ever retries — a broken build must not turn
into a self-inflicted flood.

**Reading a minified stack.** Reports carry `clientRelease` (the commit sha the
browser was running). Source maps for that build are on the corresponding
_Deploy web_ workflow run, as the `sourcemaps-<sha>` artifact — kept 30 days
and never published, since a public map is a published source tree. Download
it, then `pnpm dlx source-map-cli resolve <file>.map <line> <column>`.

### Metrics & alerts

`GET /metrics` serves Prometheus text from in-process counters. There is no
metrics vendor and no Prometheus server: for one instance, a curl is the
scrape. The trade is stated where it lives (`apps/server/src/metrics.ts`) —
counters reset on restart and there is no history. History of _availability_
comes from the uptime check; history of _what happened_ comes from the logs,
which are retained for 30 days.

```sh
# Locally: loopback is allowed without a token.
curl -s localhost:3001/metrics

# Deployed: a bearer token is required, and without ADMIN_TOKEN set the
# endpoint answers 404 to everything remote — which is the default.
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api-staging.deckxi.rishikeshs.dev/metrics
```

Series worth watching: `deckxi_active_rooms`, `deckxi_active_sockets`,
`deckxi_active_games`, `deckxi_games_finished_total` by `reason` (a rising
share of `opponents-forfeited` means people are dropping out),
`deckxi_command_failures_total` (handler bugs — should be flat at zero),
`deckxi_store_write_failures_total` (persistence degraded),
`deckxi_client_errors_total`, and the `deckxi_game_duration_seconds` histogram.

**Uptime** is `uptime.yml`: every 15 minutes it probes `/health`, and on two
consecutive failures opens a GitHub issue labelled `incident` (and comments on
it while the outage lasts, then closes it on recovery). GitHub emails issue
notifications, so that is the alert channel — free, and one fewer account than
a monitoring SaaS. Granularity is the price: cron is best-effort and never
finer than five minutes.

**Error alerting** is worth adding in the Cloud Console once real users exist,
and is free at this volume: Logging → _Create log-based alert_ on

```
resource.labels.service_name="deckxi-api-staging"
jsonPayload.event=~"^error\.|^command\.failed$"
```

with an email notification channel. Cloud Monitoring's alerting has no charge
for log-based metrics at this scale; keep the notification channel to email
(SMS is billable).

### Admin dashboard

`/admin` on the web app (staging: `https://staging.deckxi.rishikeshs.dev/admin`)
shows the rooms the server currently has open — phase, occupancy, who dropped,
the round in progress and how long the room has been idle.

Getting in needs one of:

- **an account** whose email is in `ADMIN_EMAILS`. That is a repository/
  environment **variable** (Settings → Variables), not a secret, and it is
  passed through by `deploy-api-cloudrun.yml`. Unset means nobody can get in,
  which is the safe default and also what a fresh clone does. There is no role
  column deliberately — see the note at the top of `apps/server/src/admin.ts`.
  Sign in with Google or a magic link first; a guest session can never match,
  because guests carry a placeholder email.
- **`ADMIN_TOKEN`** as a bearer token, for curl and scripts. Optional; when
  unset, `/metrics` falls back to loopback-only and the admin API is
  session-only.

```sh
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api-staging.deckxi.rishikeshs.dev/api/admin/rooms | jq
```

Everything under `/api/admin` answers **404** to an unauthorised caller,
including the dashboard's own "am I an admin" probe. So a 404 from the admin
UI means "you are not an admin" as often as it means "typo" — that ambiguity is
bought deliberately, since an endpoint that answers 401 has confirmed it exists.

The dashboard polls every 5 seconds and stops polling while its tab is hidden,
so a forgotten tab cannot hold a scale-to-zero instance warm.

## Incidents

1. **Is it up?** `curl https://api-staging.deckxi.rishikeshs.dev/health`. A
   503 with `{"db":"unreachable"}` is Neon or the connection string; anything
   else (timeout, 502, a 503 from the proxy) is the service.
2. **Logs:**
   `gcloud run services logs read deckxi-api-staging --region "$REGION" --limit 100`.
3. **Restart:** redeploy the current revision. It clears in-memory rooms, so
   every live game ends. Say so before doing it.
4. **Neon down / connection storm:** check the Neon status page and the
   project's connection count. `PostgresMatchStore` pools at 10 connections;
   the game itself keeps running without the database — only persistence and
   sign-in break.
5. **Free tier exceeded / surprise bill:** `--max-instances 1` caps the damage
   by construction. Check the budget alert, then confirm nothing pinned the
   service warm (`--min-instances` should be 0).

Known blast radius: a restart, a redeploy, or a scale-to-zero after an idle
period drops all live rooms. That is accepted until Phase 10 adds the Redis
adapter and multi-instance support.

## Failure modes worth recognising

| Symptom                                                | Cause                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails at the _Migrate_ job                      | Bad migration. Nothing shipped; fix forward on a branch.                                                                                                                                |
| Google's `Error 404 (Not Found)!!1` page on `/healthz` | Cloud Run reserves that exact path and answers it itself — the request never reaches the container. Use `/health`. A response with no `x-cloud-trace-context` header never hit the app. |
| Google's `Error 404` page on every path                | DNS reaches Google but no domain mapping claims that Host. Check `gcloud beta run domain-mappings list --region "$REGION"`, and that the service is in the region you think it is.      |
| Server exits at boot with `APP_ENV=… requires: …`      | A secret is missing or unreadable — check `--set-secrets` and the deployer's `secretAccessor` role.                                                                                     |
| Browser console: CORS / websocket `origin not allowed` | The web origin isn't in `CORS_ORIGINS` for that environment.                                                                                                                            |
| PR preview can't reach the API                         | Preview host doesn't match `https://*.deckxi-web.pages.dev`.                                                                                                                            |
| CI: "schema.ts has changes with no migration"          | Run `pnpm --filter @deckxi/server db:generate`, commit the SQL.                                                                                                                         |

## Migrating the API to Fly

`fly.staging.toml`, `fly.production.toml` and `deploy-api.yml` are kept current
so this stays a config change rather than a rewrite — it's the same image.

1. `fly apps create deckxi-api` and set its secrets (`DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
2. Add `FLY_API_TOKEN` to the GitHub environment.
3. `fly certs add -a deckxi-api api.deckxi.rishikeshs.dev`, and add the DNS
   records **alongside** the Cloud Run ones — don't delete anything yet.
4. Deploy to Fly, then check `/health` against the Fly hostname directly.
5. Flip DNS to Fly. Games in progress on the old service keep running until
   their players reconnect.
6. Point the `deploy.yml` job at `deploy-api.yml`, then delete the Cloud Run
   service and its domain mapping.

Both platforms read the same `DATABASE_URL` and run a single instance, so the
only real cutover moment is the DNS flip.
