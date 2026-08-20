# MedRota Private-Beta Deployment

How to run MedRota for a private beta. This is not a production-hardened
deployment guide — see `PRIVATE_BETA_READINESS.md` for what is and is not
covered.

## Prerequisites

| Component | Requirement |
|---|---|
| Node.js | 22 or newer |
| PostgreSQL | 15 or newer (CI runs 17) |
| TLS | Terminated in front of the API. MedRota does not terminate TLS itself. |
| Backups | Configured **before** the first real schedule is entered |

## Environment

Copy `backend/.env.example` to `backend/.env` and fill it in. Every variable is
documented there.

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | PostgreSQL only |
| `JWT_SECRET` | Signs session tokens | The server refuses to boot without it. Changing it signs everyone out. |
| `APP_BASE_URL` | Public URL of the **frontend** | Used to build invite links. Leaving it unset makes every invite point at `localhost`. |
| `CORS_ORIGINS` | Browser origins allowed to call the API | Comma-separated, no trailing slashes |
| `NODE_ENV` | `development` or `production` | `production` enables HSTS, hides internal error text, tightens the auth rate limit, and makes the QA seed refuse to run |
| `PORT` | API listen port | Defaults to 3000 |

Generate a secret per environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Deploying

```bash
# Backend
cd backend
npm ci
npx prisma migrate deploy
npm start

# Frontend
cd frontend
npm ci
npm run build          # emits dist/, serve it as static files
```

`prisma migrate deploy` applies pending migrations in order and never resets.
**Never run `prisma migrate reset` or `prisma db push` against a database that
holds real schedules** — both destroy data.

Confirm the state before and after:

```bash
npx prisma migrate status
```

One migration is guarded and will stop a deployment on purpose:
`20260820000000_unique_call_assignment_role_slot` refuses to apply while
duplicate `(callDayId, roleOnDay)` rows remain, and names the commands to
resolve them. See `LEGACY_DATA_REPAIR.md`.

## Health checks

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/health` | The process is up | Load-balancer liveness |
| `GET /api/health/ready` | The database answers | Readiness gate, deploy verification |

Readiness returns `503` with `{"status":"degraded","database":"unreachable"}`
when the database is down. Neither endpoint reveals the connection string, the
driver error, or any credential.

## Shutdown

The server handles `SIGTERM` and `SIGINT`: it stops accepting connections, lets
in-flight requests finish, disconnects Prisma, and exits. If requests have not
drained after 10 seconds it exits anyway. Give your process manager at least 15
seconds before it sends `SIGKILL`, so a redeploy cannot cut a transaction
mid-write.

## Backups

**Set this up before the first real schedule is entered.** MedRota has no
built-in backup, export-everything, or undo. The audit trail records what
changed but is not a restore mechanism.

Nightly logical backup:

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --file "medrota-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$DATABASE_URL"
```

Restore into an empty database:

```bash
createdb medrota_restored
pg_restore --no-owner --dbname medrota_restored medrota-20260820T010000Z.dump
```

Notes:

* Store dumps encrypted and off the database host. They contain resident names,
  emails and the full call schedule.
* **A backup you have never restored is not a backup.** Restore into a scratch
  database and confirm the row counts at least once before the beta starts.
* Take a fresh dump immediately before every deployment that includes a
  migration.
* Retention and deletion are deliberately not automated. Decide a retention
  period and apply it yourself.

Quick sanity check after a restore:

```sql
SELECT
  (SELECT COUNT(*) FROM "Program")         AS programs,
  (SELECT COUNT(*) FROM "ResidentProfile") AS residents,
  (SELECT COUNT(*) FROM "CallAssignment")  AS assignments,
  (SELECT COUNT(*) FROM "ScheduleVersion") AS published_versions,
  (SELECT COUNT(*) FROM "AuditEvent")      AS audit_events;
```

## Verifying a deployment

```bash
curl -fsS https://api.example.org/api/health         # {"status":"ok"}
curl -fsS https://api.example.org/api/health/ready   # {"status":"ok","database":"reachable"}
```

Then, in a browser: register or sign in, open a block calendar, and confirm the
readiness panel loads. A published schedule's public link should resolve for a
logged-out visitor.

## Operational commands

```bash
cd backend

npm run data:integrity-audit     # read-only integrity report, prints no names
npm run deploy:smoke             # headers, body limits, health, shutdown wiring
npx prisma migrate status        # pending migrations
```

Do **not** run `npm run dev:seed-qa` against a database holding real data. It
refuses when `NODE_ENV=production`, but that is a guard rail, not a guarantee.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request and needs no
deployment credentials:

* **Backend** — `npm ci`, `prisma validate`, `prisma migrate deploy` against a
  disposable PostgreSQL service (which proves migrations apply cleanly from
  empty), then the full behavioral suite.
* **Frontend** — `npm ci`, performance guard, lint, build.
* **End-to-end** — Playwright against a real database, seeded by the QA script,
  with failure artifacts uploaded.

## What is deliberately not automated

* Deployment itself. No pipeline pushes to any environment.
* Backup scheduling, retention and deletion.
* TLS termination and certificate renewal.
* Database user and network hardening.
