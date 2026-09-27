# Preventive Maintenance Automation System — Phase 1

Built from the actual structure of `Master_List_of_Plant_Machinery_SG_LLP_PM_PD_Plan_FY_26-27_updated.xlsx`.

## What's implemented (Phase 1 + core of Phase 2)

- PostgreSQL schema: Machine, Employee, MachineResponsibility, PMPlan, PMActual,
  NotificationLog, AuditLog, ImportBatch (`app/models/models.py`)
- Excel importer supporting all 3 plan-encoding formats found in your workbook:
  - `EXACT_DATE` (PD Plan, FY23-24)
  - `DAY_OF_MONTH` (PD Plan-, Auto line)
  - `WEEK_CODE` W1–W5 (PM Plan-26-27), converted to calendar dates using the
    **locked convention**: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–end of month.
  - Unknown/unparseable cells are recorded as warnings, never guessed.
  - Validated directly against your uploaded workbook (see test run below).
- Import service with preview (no writes) vs commit mode, duplicate prevention
  via a DB unique constraint, and full source traceability (file/sheet/cell).
- Notification abstraction (`app/notifications/`) with three interchangeable
  email providers already wired in:
  - **Microsoft 365 / Outlook** (Graph API, `m365_provider.py`)
  - **Gmail** (Gmail API OAuth2, `gmail_provider.py`)
  - **Generic SMTP** fallback (works with either, via app password/SMTP AUTH)
  - Switch active provider anytime via `EMAIL_PROVIDER` in `.env` — no business
    logic changes needed. Both can be added independently, at your own pace.
- Reminder/escalation job (`app/jobs/reminder_jobs.py`) using idempotency keys
  (`pm_id + type + date`) so a scheduler restart can never double-send.
- REST API: machines, PM plans (list/upcoming/overdue/complete), Excel import
  (upload/preview/commit), health checks.
- APScheduler running the daily reminder job at 08:00 Asia/Kolkata.

- Next.js + TypeScript + Tailwind dashboard (`frontend/`): KPI cards, upcoming/
  overdue tables, machines list, and the full 7-step Excel import wizard
  (upload → select sheet → detect → preview → validate → import → summary),
  talking to the backend via `NEXT_PUBLIC_API_URL`. Builds clean with
  `next build` (verified).

- **Auth/RBAC**: JWT login (`POST /api/auth/login`), bcrypt password hashing,
  `require_roles(...)` dependency protecting PM completion, Excel import,
  employee admin, and report endpoints per the 5 roles in the spec (Admin,
  Manager, Supervisor, Technician, Viewer).
- **Audit logging**: `record_audit()` helper wired into login, PM completion,
  Excel upload/commit, employee creation, and report generation — answers
  "who changed this and when" via `GET /api/audit-logs` (Admin/Manager only).
- **Monthly report engine** (`app/reports/`): computes Plan/Actual/Pending/
  Overdue/Completion-rate/On-time-rate, machine-wise, location-wise and
  employee-wise breakdowns, and an overdue list — exactly per spec section 14.
  Renders to both **PDF** (reportlab) and **Excel** (openpyxl) via
  `GET/POST /api/reports/monthly` and `/api/reports/monthly/generate`.
- **Monthly scheduled job**: runs 1st of each month at 09:00 IST, generates
  the previous month's report and emails a summary to `REPORT_RECIPIENTS`
  (comma-separated in `.env`) via whichever email provider is active.

## Not yet implemented (next phases)

- WhatsApp/SMS providers — Phase 5

## Phase 4 additions (this update)

- **Alembic migrations**: `backend/alembic/versions/0001_initial.py` creates the
  full schema by hand (matches `app/models/models.py`). `Base.metadata.create_all`
  now only runs when `ENV=development`; everywhere else, run
  `alembic upgrade head` as a deploy step (the Docker image does this
  automatically on container start).
- **Excel sync/diff**: `POST /api/import/excel/preview` now does a real
  add/changed/removed diff (previously preview mode always reported every row
  as "created" — fixed). Rows removed from the re-uploaded sheet are flagged
  and, on commit, cancelled rather than hard-deleted (a plan with a recorded
  completion is left untouched either way).
- **Frontend login + role-aware UI**: `/login`, a cookie-based JWT session
  (`frontend/lib/auth.ts`), route protection via `middleware.ts`, and a
  role-filtered sidebar (Import/Audit/Admin links only show for the roles
  that can use them).
- **PDF/Excel attached to report emails**: `EmailAttachment` support added to
  all three providers (SMTP, Gmail, M365); the monthly job now attaches the
  real PDF + Excel files instead of a text-only summary.
- **Attachment/photo upload on PM completion**: `POST /api/pm/{id}/complete`
  is now `multipart/form-data` and accepts an optional `attachment` file
  (image or PDF, 15MB cap); `GET /api/pm/{id}/attachment` retrieves it. A
  simple completion form lives at `/pm/[id]/complete` in the frontend.
- **Admin settings panel**: new `app_settings` table + `/api/admin/settings`
  (Admin only) exposes `reminder_days_before`, `due_tomorrow_days_before`,
  `escalation_thresholds`, and the week→date convention
  (`week_band_size_days`, `week_start_offset_days`) as DB-backed, live-tunable
  values — no code deploy needed. Frontend page at `/admin`.

## Local setup (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# edit .env with your DB and email provider credentials
alembic upgrade head
uvicorn app.main:app --reload
```

Database via Docker:
```powershell
docker compose up -d db
```

Frontend (in a second terminal):
```powershell
cd frontend
npm install
npm run dev
```
Then open http://localhost:3000 — it talks to the backend at
`NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

## Docker (full stack)

```bash
docker compose up --build
```

## Testing the importer against your real file

```bash
python -c "
from app.importer.excel_importer import load_workbook_from_path, parse_pm_sheet
wb = load_workbook_from_path('path/to/your.xlsx')
result = parse_pm_sheet(wb['PM Plan-26-27'], 'PM Plan-26-27', '26-27')
print(len(result.rows), 'machines parsed,', len(result.warnings), 'warnings')
"
```
This was run against your uploaded file: **90 machine rows parsed, 0 warnings,
0 errors** for the FY26-27 week-code sheet.

## Notification provider setup

**Microsoft 365**: register an Azure AD app, grant `Mail.Send` (application,
admin-consented), fill `MS365_TENANT_ID/CLIENT_ID/CLIENT_SECRET/SENDER_ADDRESS`.

**Gmail**: enable the Gmail API in a Google Cloud project, create an OAuth2
client, run a one-time consent flow to get a refresh token, fill
`GMAIL_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/SENDER_ADDRESS`.

Set `EMAIL_PROVIDER=m365` or `gmail` or `smtp_generic` in `.env` to pick which
is active. You can add one now and the other later without any code changes.

## Running the automated tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

`tests/test_excel_importer.py` covers the importer's edge cases (mixed
date formats, week codes, day-of-month clamping/overflow, copy-forward
P==A detection, footer-row cutoff, the review-queue flags, and the
near-duplicate normalization rule) as pure-function tests - no Postgres
needed. Run this before pointing a new build at production data, and add
a case here any time a new "weird real spreadsheet" pattern shows up.

## Timezone handling

Business-logic "what day is it" checks (daily reminders, overdue/upcoming
queries, monthly report period) go through `app/core/timeutils.py`
(`today_local()` / `now_local()`), which is explicitly `Asia/Kolkata`-aware
via `settings.TIMEZONE` - not `date.today()`/`datetime.now()`, which use
whatever timezone the server process happens to be in (UTC in most
containers). Without this, a server on UTC would compute "today" a day
behind IST for roughly 18:30–23:59 UTC every day, silently shifting
reminders/escalations by a day for that window. `datetime.utcnow()` is
still used (correctly) for pure timestamp columns - `created_at`,
`sent_at`, JWT expiry - where UTC is the right choice and there's no
"business day" boundary involved.

## Backup & restore

`scripts/backup.sh` runs a `pg_dump -Fc` (compressed, restorable with
`pg_restore`) against the `db` container, verifies the dump is non-empty
before declaring success, and prunes dumps older than `RETENTION_DAYS`
(default 30). Run it from the host via cron, not from inside
docker-compose - a backup shouldn't live on the same machine/volume it's
protecting against by default; point `BACKUP_DIR` at separate storage
(NAS, S3-mounted path, etc).

```bash
BACKUP_DIR=/mnt/backups/pm_system ./scripts/backup.sh
# suggested cron: 0 2 * * *  (2am IST, clear of the 8am reminder job)
```

`scripts/restore.sh` restores a dump, but always into a scratch database
first:

```bash
./scripts/restore.sh backups/pm_system_20260911_020000.dump pm_system_restore_test
# inspect pm_system_restore_test - row counts, spot-check a few machines/plans
./scripts/restore.sh backups/pm_system_20260911_020000.dump pm_system   # only once verified
```

It requires typing the target database name to confirm before it drops
anything, since a restore is destructive by nature.

This covers backup/restore mechanics; it does not replace testing an
actual disaster-recovery drill (kill the `db` volume, restore from the
latest dump, confirm the app comes back clean) before this becomes the
system of record.

## Production hardening

The items below were flagged by a release-readiness review and are tracked
here so it's clear what's actually fixed vs. what's still a conscious
tradeoff for a later pass.

**Fixed:**
- **CORS** is no longer `*` — set via `CORS_ORIGINS` (comma-separated), and
  the app now **refuses to start** with `ENV=production` if it's still `*`
  or empty (see `_validate_production_config()` in `app/main.py`).
- **Secrets** — same startup check refuses to boot in production with the
  default `JWT_SECRET`, a secret under 32 chars, or the default DB password.
  Generate a real one: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
- **Attachment storage** — `ATTACHMENT_DIR` now defaults to `/data/pm_attachments`
  (not `/tmp`) and is configurable via env; `docker-compose.yml` mounts a
  named volume there so a container recreate doesn't wipe proof-of-work
  photos. Still local-disk, not object storage — see "Not fixed" below.
- **DB startup race** — `docker-compose.yml`'s `db` service now has a real
  `pg_isready` healthcheck, and `backend` depends on `service_healthy`
  (not just container-started) before running migrations.
- **Login brute-force** — `/api/auth/login` is now rate-limited
  (`LOGIN_RATE_LIMIT_ATTEMPTS` per `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, per
  IP+email). It's in-process memory, so the real limit across N backend
  instances is N× this — pair with a proxy/WAF-level limit if you scale out.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` always on; `Strict-Transport-Security` added when
  `ENV=production` (only meaningful behind real HTTPS).
- **Scheduler duplication** — reminder/report jobs now take a Postgres
  advisory lock before running (`app/jobs/scheduler.py`), so scaling to
  multiple backend instances no longer sends duplicate reminder emails or
  generates the report twice — each instance's APScheduler still fires on
  schedule, but only the one that wins the lock actually executes.
- **Next.js had real, patched CVEs at the pinned version** — `14.2.15`
  bumped to `14.2.35` (includes fixes for, among others, the CVE-2025-29927
  middleware authorization bypass and the CVE-2025-55184/55183 RSC DoS /
  source-exposure issues). Same 14.x line, patch-only bump — verified with
  a clean `next build` after upgrading, no code changes needed.
- **Dockerfiles ran as root** — both now create and switch to a non-root
  `appuser`. The backend's attachment volume mount point is `chown`'d
  *before* the volume is first created (Docker copies a fresh named
  volume's initial ownership from the image directory it's mounted over),
  otherwise it would mount root-owned and every upload would 500.
- **No `.dockerignore`** — added for both services. Without one, `COPY . .`
  would happily bake a local `.env` (JWT secret, DB password) or `.git`
  history into the image layer if either happened to exist in the build
  context. Also switched the frontend build to `npm ci` (not `install`) so
  it installs exactly what's in the lockfile.

**Deliberately not fixed — real tradeoffs, not oversights:**
- **Auth token storage** — the frontend still stores the JWT in a
  JS-readable cookie (not `httpOnly`). Moving to a server-set `httpOnly`
  + `Secure` + `SameSite` cookie is the right long-term move, but it's an
  architecture change (backend needs to set the cookie on login, CORS needs
  `allow_credentials` tuned per-origin — already done — and every fetch call
  needs `credentials: "include"`), and it needs to be tested end-to-end
  against a real deployed frontend+backend pair before it ships, not pushed
  untested. Treat this as the next auth-hardening task, not "already done."
- **Attachments are still local disk**, not S3/Azure Blob/MinIO. The
  persistent volume fix above solves "survives a container restart"; it
  does not solve "survives losing that host" or "scales past one backend
  instance sharing one disk." Swapping this for real object storage is a
  contained change (one file's worth of save/read functions) but needs
  actual cloud credentials to build and test against, which this environment
  doesn't have.
- **Frontend `NEXT_PUBLIC_API_URL`** is a Next.js *build-time* value —
  `docker-compose.yml` now reads it from an env var instead of a hardcoded
  `localhost:8000`, but you still need to build the frontend image with the
  real API URL for your deployment (rebuild, don't expect changing the env
  var at container-run-time to do anything — Next.js bakes `NEXT_PUBLIC_*`
  in at build time).

- Frontend → Vercel, Backend → Render/Railway or your own container host,
  PostgreSQL → managed Postgres. Nothing here is tied to a single provider.
- Alembic migrations are now real (see Phase 4 notes above) — just run
  `alembic upgrade head` against production before first deploy.

