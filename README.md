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
