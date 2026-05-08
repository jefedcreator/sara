FROM node:24.15.0-alpine AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache libc6-compat openssl

FROM base AS deps

COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile

FROM base AS dev

ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["yarn", "dev"]

FROM base AS build

ENV SKIP_ENV_VALIDATION=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM base AS prod-deps

ENV YARN_IGNORE_SCRIPTS=1

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

FROM base AS production

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/generated ./generated
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nextjs:nodejs /app/next.config.js ./next.config.js

USER nextjs
EXPOSE 3000
CMD ["yarn", "start"]
