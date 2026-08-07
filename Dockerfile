# syntax=docker/dockerfile:1
#
# Multi-stage build for App Runner (or any container host). Verified against
# this repo directly, not copied from a generic template:
#   - `output: 'standalone'` (next.config.ts) traces only the files each route
#     needs, so the runtime stage ships without `node_modules`.
#   - `next build` evaluates every route module during "Collecting page data"
#     (all pages are `dynamic = 'force-dynamic'`, so none prerender, but the
#     module still loads) — `src/db/index.ts` throws at import time if
#     DATABASE_URL is unset, so the builder stage needs *a* connection string
#     present. It is never connected to during build; a placeholder is enough.
#   - Clerk's publishable key is read from `process.env` per-request on the
#     server and handed to the client provider from there — confirmed by
#     building with no Clerk env vars at all and it succeeding. So, unlike the
#     DATABASE_URL guard, Clerk keys do NOT need to be build args; they only
#     need to be real at container runtime (set on the App Runner service).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Build-time-only placeholder — see the header comment. The real value comes
# from the App Runner service's runtime environment, not from this image.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Setting this here is NOT sufficient on every host. AWS App Runner (and
# likely other managed container platforms) injects its own HOSTNAME into
# the running container, which overrides an image-baked ENV of the same
# name — Dockerfile ENV is a default, not a floor, and a platform-injected
# runtime value for the same key wins. When that happens, Next's standalone
# server binds to that hostname instead of all interfaces, the process logs
# "Ready" and looks completely healthy, but nothing external can reach it —
# App Runner's health check fails with a generic "check your configured
# port number" and zero request-level logs ever appear, because no request
# ever reached the socket. Confirmed by comparing the "Local:"/"Network:"
# URLs Next prints on startup: both showed the platform's internal hostname
# instead of localhost. The fix is forcing HOSTNAME=0.0.0.0 as an explicit
# RuntimeEnvironmentVariable on the App Runner service itself (see
# deploy/aws/apprunner-service.json and DEPLOY_AWS.md), not just here.
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
