# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
# sara

## Docker development

This project can run fully inside Docker with a Postgres container. The setup is compatible with Colima on macOS; Docker Desktop is not required.

### First run with Colima

```bash
colima start
docker context use colima
docker compose up --build
```

The app is available at http://localhost:3000 and Postgres is exposed only on `127.0.0.1:5432` for local tools.

The Compose setup runs `yarn db:push` before starting Next.js, so the Postgres schema is created automatically from `prisma/schema.prisma`.

Prisma commands run from your host use the Docker-published database URL in `.env`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sara"
```

Inside Docker, Compose overrides `DATABASE_URL` to use the internal service hostname:

```bash
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/sara"
```

### Useful commands

```bash
yarn docker:up      # build and start app + postgres
yarn docker:logs    # follow app and postgres logs
yarn docker:down    # stop containers, keep database volume
docker compose down -v # stop containers and delete database data
```

If `docker compose` or Docker image builds are unavailable, install the Compose and Buildx plugins for the Docker CLI:

```bash
brew install docker-compose docker-buildx
mkdir -p ~/.docker/cli-plugins
ln -sf /usr/local/lib/docker/cli-plugins/docker-compose ~/.docker/cli-plugins/docker-compose
ln -sf /usr/local/lib/docker/cli-plugins/docker-buildx ~/.docker/cli-plugins/docker-buildx
```

If you previously used Docker Desktop, remove the stale Desktop credential store from `~/.docker/config.json`:

```json
{
  "auths": {
    "https://index.docker.io/v1/": {}
  },
  "currentContext": "colima"
}
```

Then verify the CLI:

```bash
docker compose version
docker buildx version
```

## Appointment scheduling

Bookings carry their own availability rules. A business sets its weekly working hours and one-off closures via `GET`/`PUT /api/business/hours` and `GET`/`POST /api/business/closures` + `DELETE /api/business/closures/[id]`; `GET /api/services/[slug]?date=YYYY-MM-DD` returns the service together with that day's slots, each flagged `isAvailable` after accounting for working hours, closures, existing bookings, and (if connected) the owner's Google Calendar. A business with no configured hours or closures is simply open by default — none of this requires setup before bookings work.

Booking confirmation, cancellation, reschedule, and a 24-hours-ahead reminder are sent by email (via Resend — set `RESEND_API_KEY`). Reminders are dispatched by `GET /api/cron/booking-reminders`, which your scheduler must call periodically (hourly is a reasonable default). The route checks the `Authorization: Bearer <CRON_SECRET>` header itself rather than going through normal user auth — set `CRON_SECRET` and configure whichever scheduler your deployment uses (Vercel Cron, system cron, a Docker sidecar, a k8s CronJob) to call the endpoint with that header.

### Connecting Google Calendar

A business owner connects their Google Calendar from `GET /api/business/google-calendar/connect` (and disconnects via `DELETE /api/business/google-calendar`). This reuses the existing `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` OAuth client — no separate credentials are needed — but it is a one-time setup step in the Google Cloud Console for that OAuth client:

1. Enable the **Google Calendar API** for the project.
2. Add a second authorized redirect URI (the login flow already uses one for `/api/auth/google/callback`):
   ```
   http://localhost:3000/api/business/google-calendar/callback
   ```
   (swap the host for your deployed domain in production).

Once connected, confirmed bookings appear as events on the owner's calendar, cancellations remove them, and reschedules move them. Availability calculation also excludes anything already busy on that calendar. None of this is required for bookings to work — a business with no calendar connected behaves exactly as one always has.
