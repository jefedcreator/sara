# Deploying sara

Host: `opc@84.12.92.46` — Oracle Linux 9, aarch64. Port `3003`.
Hostname: `sara.84-12-92-46.sslip.io` until a real domain is attached.

Shares the host with parcours (`3000`), strive (`3001`) and 0nbox (`3002`).
Host-level operations (bootstrap, firewall, 502 triage) are documented once,
in the parcours repo's `deploy/README.md`. `bootstrap-oracle.sh`,
`prune-releases.sh`, `deploy.sh`, `ecosystem.config.cjs` and `nginx/` match
the other repos; only usage examples differ.

## Pipeline

`.github/workflows/deploy.yml` runs two jobs:

1. **check** — lint, typecheck and tests, on every pull request and every
   push to `main`.
2. **deploy** — only on `main` (push or manual run), only after `check`
   passes. Builds on an ARM runner, uploads a release to
   `/srv/sara/releases/<sha>`, runs `prisma migrate deploy`, swaps
   `/srv/sara/current` and restarts under pm2. If `/api/health` does not
   answer within 60s, the previous release is restored.

## Required repository secrets

Add these under **Settings -> Secrets and variables -> Actions**:

| Secret | Purpose |
|---|---|
| `SSH_HOST` | `84.12.92.46` |
| `SSH_USER` | `opc` |
| `SSH_KEY` | Private key contents, whole file including header and footer |
| `DATABASE_URL` | Postgres connection string |
| `DIRECT_URL` | Optional: direct (non-pooled) connection for migrations. Unset, `DATABASE_URL` is used |
| `AUTH_SECRET` | Auth.js secret (`npx auth secret`) |
| `NEXT_PUBLIC_APP_URL` | `http://sara.84-12-92-46.sslip.io` until a real domain is attached. Inlined at build time |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Service photo uploads |
| `CLIENT_ID`, `CLIENT_SECRET` | Required for Google sign-in and Calendar sync (sign-in button disabled if unset) |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `CONFIGURATION_ID` | Required for Facebook sign-in (sign-in button disabled if unset) |
| `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | Required for Instagram sign-in (sign-in button disabled if unset) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional: transactional email. Unset, emails go to `pm2 logs sara` |
| `CRON_SECRET` | Optional: guards the booking reminder endpoint (see below) |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Optional: payments |
| `MONO_CLIENT_ID`, `MONO_SECRET_KEY`, `NEXT_PUBLIC_MONO_PUBLIC_KEY` | Optional: Mono bank connect |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `META_APP_SECRET` | Optional: WhatsApp Cloud API |
| `NEXT_PUBLIC_SARA_WHATSAPP_NUMBER` | Optional: landing page "Start on WhatsApp" number, digits only |
| `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_IG_ID`, `INSTAGRAM_PAGE_TOKEN` | Optional: Instagram messaging |
| `ATLAS_API_URL` | Optional: leave unset until Atlas is deployed (see below) |

`NEXT_PUBLIC_*` values are baked into the build, so changing one needs a
re-run of the workflow, not just a server restart.

## First-time host setup

Idempotent — safe to re-run:

```bash
bash deploy/bootstrap-oracle.sh
bash deploy/app-setup.sh sara 3003 sara.84-12-92-46.sslip.io
```

sara pins Node `24.15` (`.nvmrc`, `engines`). The bootstrap does not install
Node, so check the host's version first: `node --version`.

## Attaching a real domain

Point an A record at `84.12.92.46`, wait for it to resolve, then:

```bash
LETSENCRYPT_EMAIL=you@example.com \
  bash deploy/attach-domain.sh sara sara.example.com www.sara.example.com
```

Then update `NEXT_PUBLIC_APP_URL` in the repo secrets, re-run the workflow, and
update every external URL that names the origin:

- OAuth redirect URIs: `<APP_URL>/api/auth/google/callback`,
  `<APP_URL>/api/auth/facebook/callback`, `<APP_URL>/api/auth/instagram/callback`
  and `<APP_URL>/api/business/google-calendar/callback`
- Webhooks: `<APP_URL>/api/webhooks/whatsapp`, `/api/webhooks/instagram`,
  `/api/webhooks/paystack`. Meta and Paystack require HTTPS, so webhooks only
  work after this step.

## Booking reminders

`GET /api/cron/booking-reminders` sends the 24-hours-ahead reminder emails
and needs a scheduler. Add it to the deploy user's crontab (`crontab -e`):

```cron
0 * * * * curl -fsS -o /dev/null -H "Authorization: Bearer $(sed -n 's/^CRON_SECRET="\(.*\)"$/\1/p' /srv/sara/shared/.env)" http://127.0.0.1:3003/api/cron/booking-reminders
```

## Atlas

The Atlas maps server is not deployed here yet. The workflow points
`ATLAS_API_URL` at a closed loopback port, so geocoding a new business and
routing a booking fail fast and are skipped (both are non-fatal), and the
`/api/atlas/*` routes return errors. Without that, the client's
`localhost:3001` fallback would reach strive. Once Atlas runs, set the
`ATLAS_API_URL` secret and re-run the workflow.

## Day-to-day operations

```bash
pm2 list                      # every app on the host
pm2 logs sara                 # follow sara logs
pm2 logs sara --lines 100 --nostream
cat /srv/ports.env            # who owns which port
df -h /                       # releases accumulate; deploy.sh keeps 3
```

## Rolling back by hand

`deploy.sh` rolls back automatically when a health check fails. To go back after
a deploy that passed but misbehaves:

```bash
ls -1dt /srv/sara/releases/*/        # newest first
ln -sfn /srv/sara/releases/<sha> /srv/sara/current.tmp
mv -Tf /srv/sara/current.tmp /srv/sara/current
cd /srv/sara/current
APP_NAME=sara APP_PORT=3003 pm2 startOrRestart deploy/ecosystem.config.cjs --update-env
pm2 save
```

A rollback does not undo a migration that already ran. The restored release
runs against the newer schema.
