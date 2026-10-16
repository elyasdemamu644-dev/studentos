# StudentOS — production deployment on Render + Neon (free tier)

This is the **chosen** production path. The container-based alternative
(Docker Compose + Caddy + host firewall on an Oracle Always Free VM) is kept in
[`free-production.md`](free-production.md) as the fallback if Render's free-tier
limits ever stop fitting.

Validate `render.yaml` before every use — CI does it on each push
(`deploy-config` job in `.github/workflows/ci.yml`), locally:

```bash
npx js-yaml render.yaml > /tmp/render.yaml.json
curl -fsSL https://render.com/schema/render.yaml.json -o /tmp/render.yaml.schema.json
npx ajv-cli validate --spec=draft2020 --strict=false -s /tmp/render.yaml.schema.json -d /tmp/render.yaml.json
```

---

## 1. Architecture

| Piece | Choice | Why |
| --- | --- | --- |
| API | Render **web** service `studentos-api`, Docker (root `Dockerfile`, stage `api`), free plan, Oregon | Free plan has no one-off jobs, so `dockerCommand` runs `prisma migrate deploy && node dist/server.js` on the single instance |
| Web | Render **web** service `studentos-web`, Docker (`frontend/Dockerfile`, Next standalone), free plan, Oregon | `NEXT_PUBLIC_API_URL` is baked into the client bundle at build time (Render passes env vars as Docker build args) |
| Database | **Neon** project (external to Render) | Render's own free Postgres expires after 30 days; Neon Free persists |
| Outbound egress | `EGRESS_MODE=direct` (code-level guard), **no** gateway container | Render free services cannot reach each other over private traffic, so the compose topology (gateway on an internal network) cannot exist there. The SSRF guard, DNS pinning and exact `EGRESS_ALLOWED_DESTINATIONS` allowlist still run for every AI/JWKS request |
| Email | `EMAIL_ENABLED=false` | Render blocks outbound SMTP (25/465/587) on the free plan, and `direct` mode refuses `EMAIL_ENABLED` by design |

Free-plan constraints that shape everything below: no `preDeployCommand`
(paid-only), no scaling (exactly one instance → migrations are safe to run
in `dockerCommand`), ephemeral disk (deploys/restarts wipe `/app/uploads`),
15-minute idle spin-down (first request after idle takes ~30–60 s), and
no custom certificates without a paid plan (the `*.onrender.com` hostname
already serves TLS).

## 2. Prerequisites

- A GitHub account and the repo pushed (`render.yaml`, both Dockerfiles,
  `.dockerignore`, `docs/deployment/`, CI workflow). Render reads the repo, so
  an unpushed branch cannot deploy anything.
- A Render account (free tier is enough for two web services).
- A Neon account (free tier is enough for one project).
- `node` + `curl` locally, for generating secrets and validating the blueprint.

## 3. Step 1 — create the Neon database

1. Neon console → **New project** → region **AWS US West (Oregon)** (same
   region as the Render services; cross-region adds latency and can hit
   free-tier transfer limits).
2. Copy the **pooled** connection string (the `…-pooler.…` host) from the
   connection details. It looks like:
   `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DB?sslmode=require&channel_binding=require`
3. Note the **hostname only** (`ep-xxxx-pooler.REGION.aws.neon.tech`) — that
   value is used twice below (`DATABASE_URL` host and `EGRESS_DATABASE_HOST`
   must match **exactly**, `backend/src/config/index.ts`
   `productionConfigErrors`).

Do **not** paste the password anywhere in the repo. The three values derived
from Neon go only into Render's dashboard.

## 4. Step 2 — generate the two secrets locally

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it **twice** and keep the two outputs independent (`JWT_SECRET` and
`ENCRYPTION_KEY`). Each must be 43 characters of `[A-Za-z0-9_-]`; the API
refuses to boot otherwise. Never reuse a dev value, never commit them, never
write them into an issue or a log line. Rotating `ENCRYPTION_KEY` later makes
every stored AI-connection credential undecryptable (they then answer
`409 AI_CONNECTION_UNREADABLE`).

## 5. Step 3 — create the services from `render.yaml`

Render dashboard → **New + → Blueprint** → pick the GitHub repo → Render
parses `render.yaml`. Every key marked `sync: false` is left blank and must be
filled in on the confirmation screen (Render stores them as environment
variables; they are never written to git):

| Environment variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string, **keep `sslmode=require`** |
| `JWT_SECRET` | Step 2, first secret |
| `ENCRYPTION_KEY` | Step 2, second secret |
| `EGRESS_DATABASE_HOST` | Neon pooled hostname only (no scheme, no port) |
| `EGRESS_ALLOWED_DESTINATIONS` | `<neon-host>:5432,openrouter.ai:443,www.googleapis.com:443` |
| `OPENROUTER_API_KEY` | Optional. Without it, AI endpoints answer a controlled `503 AI_PROVIDER_NOT_CONFIGURED` |
| `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Optional. Must be the same OAuth web-client ID on both services to enable Google sign-in |

The remaining values (CORS origin, `NEXT_PUBLIC_API_URL`, `EGRESS_MODE`,
`TRUST_PROXY`, `UPLOAD_DIR`, migration command) are inline in `render.yaml`
and are not secrets.

If the services are ever renamed or moved to another hostname, three values
must move together: `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, and the web
service's own host — the boot-time validator rejects an origin that is not an
exact `https://` origin, and the build guard in `frontend/next.config.mjs`
refuses to bake a non-`https` API URL into the bundle.

## 6. Step 4 — first deploy

1. Render builds the API image, then runs `dockerCommand`:
   `./node_modules/.bin/prisma migrate deploy && node dist/server.js`.
   Migrations (`20261006000000_init_from_schema`,
   `20261007000000_add_owner_indexes`, `20261014000000_add_ai_persistence`)
   apply from an empty database — this is safe by design (see
   `docs/api/openapi.yaml` and the migration README notes).
2. Watch the API logs until `listening on …` appears, then:

```bash
curl -fsS https://studentos-api.onrender.com/health
# {"status":"ok","database":"connected",...}
```

3. `https://studentos-web.onrender.com/` should return the app shell. The
   first request after the service has slept will be slow; a later
   `curl -o /dev/null -w '%{time_total}\n'` shows the warm latency.

**The API fails fast** (`P1001`, boot abort) if the database is unreachable,
and the boot validator refuses to start on any of: short/placeholder secrets,
`DATABASE_URL` without `sslmode=require`, a localhost database host,
`EGRESS_DATABASE_HOST` mismatch, a missing `host:5432` allowlist entry,
`TRUST_PROXY` < 1, non-HTTPS CORS origins, `AI_ALLOW_PRIVATE_ENDPOINTS=true`,
`EMAIL_ENABLED=true` with `EGRESS_MODE=direct`, or an AI/JWKS/S3 endpoint
absent from `EGRESS_ALLOWED_DESTINATIONS`.

## 7. Step 5 — post-deploy verification

Run against the real URLs (same sequence verified locally against the bundled
container image, 26/26 green, before deployment):

```bash
API=https://studentos-api.onrender.com/api/v1
WEB=https://studentos-web.onrender.com

curl -fsS $API/health                                  # 200, database connected
curl -fsS -X OPTIONS "$API/auth/login" \
  -H 'Origin: https://studentos-web.onrender.com' \
  -H 'Access-Control-Request-Method: POST' -i          # Access-Control-Allow-Origin echoes $WEB
curl -fsS -X OPTIONS "$API/auth/login" \
  -H 'Origin: https://evil.example' -i                 # no Access-Control-Allow-Origin header
curl -s -o /dev/null -w '%{http_code}\n' "$API/courses"          # 401
curl -fsS "$WEB/" -o /dev/null -w '%{http_code}\n'               # 200
curl -fsS "$WEB/" | grep -o '/_next/static[^"]*\.js' | head -3   # asset paths
```

Then, in a browser on `$WEB`: register → log in → create a course → create a
task → upload a `.txt` resource and download it back → open the AI chat and
confirm a send without a provider key shows the friendly *not configured*
error (not a crash) → log out and confirm the refresh token is dead.

**Ephemeral disk warning:** uploads live in `/app/uploads` on the instance's
scratch disk. Every deploy, restart or re-provision **deletes them** while the
`Resource` rows stay behind (download then answers 404). For durable files,
set `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/
`S3_BUCKET` (and add `s3.<region>.amazonaws.com:443` to
`EGRESS_ALLOWED_DESTINATIONS`), or set `REQUIRE_REMOTE_STORAGE=true` to fail
closed instead.

## 8. Day-2 operations

| Task | How |
| --- | --- |
| Logs | Render dashboard → service → **Logs**; per-request lines show `METHOD path status ms` only (no query strings, no credentials) |
| Redeploy | Push to the connected branch → Render rebuilds. Migrations re-run in `dockerCommand` on every deploy (`migrate deploy` is idempotent) |
| Schema change | Commit a new `backend/prisma/migrations/<timestamp>_<name>/migration.sql`; never run `db push` against production |
| Secret rotation | Dashboard → environment → edit the variable → redeploy. Rotating `JWT_SECRET` invalidates every session (users must log in again); rotating `ENCRYPTION_KEY` makes stored AI credentials unreadable (`409`) |
| Sleep/cold start | Free services sleep after ~15 min idle; the first request wakes them (~30–60 s). `healthCheckPath` is `/health` (API) and `/` (web) |
| Database size | Neon Free = 1 project / 1 GB; there is no automated backup SLA — export periodically (`pg_dump`) and treat this tier as non-production |
| Rate limits | In-process only (`RATE_LIMIT_MAX_REQUESTS`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_DAILY_QUOTA`) and shared by the single API instance; they reset on restart |
| Teardown | Delete the Render services (Blueprint view), then the Neon project. Nothing in the repo creates cloud resources automatically |

## 9. What is verified vs. what still needs a live deployment

Verified before deployment:

- API suite **719/719 (46 files)**, web suite **299/30**, `tsc` clean, root
  `pnpm lint` clean, `prisma validate` + `migrate status` clean.
- Production-mode end-to-end against the **bundled container image** and a
  TLS Postgres: migrations from an empty database, health, CORS allow/deny,
  register/login/refresh/logout, course + task CRUD, cross-user 404s,
  multipart upload → download round-trip, controlled `503
  AI_PROVIDER_NOT_CONFIGURED`, the Next standalone server, baked API URL in
  the bundle, no secrets in the client bundle or API logs — **26/26 checks**.
- `render.yaml` validated against Render's published Blueprint schema
  (CI `deploy-config` job) and checked for `localhost`/`sync: false` rules.
- Both Docker images build (`--target api`, `--target egress`, web).

Blocked on account actions (no cloud credentials in this environment):
creating the Neon project and the Render Blueprint, entering the six
`sync: false` values, and the final live checks in §7 against the real
`onrender.com` hostnames. The Windows host cannot run `next build`
directly (symlink `EPERM` without Administrator/Developer Mode); the same
build succeeds in the Linux image and in CI.
