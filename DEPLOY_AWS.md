# Deploying to AWS (App Runner)

This app has no AWS-specific code — Neon's connection string and Clerk both
work from anywhere. What's here makes it *runnable* as a container: a
multi-stage `Dockerfile` producing a minimal `next start`-equivalent image
(`output: 'standalone'`, D-70's Node-runtime requirement unchanged), and
`GET /api/health` as an unauthenticated liveness endpoint (App Runner has no
Clerk session to present).

**Chosen over AWS Amplify Hosting deliberately.** Amplify's own docs list
Next.js 12–15 as its supported range; this app runs 16.2 and uses `proxy.ts`
(Next 16's rename of `middleware.ts`), which postdates Amplify's documented
support. App Runner just runs the container — it has no opinion on which
Next.js version is inside it, so there's no compatibility bet being made.

Everything below was verified locally: `docker build` succeeds, and the
image runs and serves `/api/health` (200) and `/` (307 → `/sign-in`,
confirming the auth boundary survives containerization) — see the commands
under "Verify locally" to reproduce that yourself before touching AWS.

## What `next build` needs vs. what the container needs at runtime

Worth knowing before you debug an env var problem:

- **`DATABASE_URL` must exist at build time**, even though it's never
  connected to. `src/db/index.ts` throws at import time if it's unset, and
  `next build` evaluates every route module while collecting page data. The
  `Dockerfile`'s builder stage sets a placeholder (`postgresql://build:build@localhost:5432/build`)
  for exactly this reason — confirmed by building with no env at all (fails
  with that exact error) and with only a placeholder `DATABASE_URL` (succeeds).
- **Clerk keys are *not* needed at build time.** Confirmed the same way —
  build succeeds with zero Clerk env vars present. Clerk reads
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from `process.env` server-side, per
  request, and hands it to the client provider from there. They only need to
  be real values in the **running container's** environment.
- **App Runner's `RuntimeEnvironmentVariables` don't strip quotes**, and
  neither does `docker run --env-file`. If you copy values out of
  `.env.local` (which quotes everything, e.g. `KEY="value"`), strip the
  quotes first — Clerk's SDK will otherwise reject a publishable key with
  literal `"` characters in it as "not valid" (this is exactly the failure
  mode hit and fixed while preparing this).
- **App Runner overrides the image's `HOSTNAME`.** The Dockerfile bakes
  `ENV HOSTNAME=0.0.0.0` so the standalone server binds to all interfaces,
  but a platform-injected runtime env var for the same key beats a
  Dockerfile default — App Runner sets its own `HOSTNAME` (the instance's
  internal hostname) unless you force it. When that happens, the container
  looks completely healthy — Next logs "Ready", the process never crashes —
  but the health checker can't reach the socket, since it's bound to a
  specific hostname instead of `0.0.0.0`. Symptom: `CREATE_FAILED` with
  "Health check failed... Check your configured port number", and *zero*
  application-log lines beyond the startup banner, because no request ever
  actually lands. Fixed by forcing `HOSTNAME=0.0.0.0` and `PORT=3000` as
  explicit `RuntimeEnvironmentVariables` on the service itself (already in
  `deploy/aws/apprunner-service.json`) — a Dockerfile `ENV` alone isn't
  enough on this platform. Confirm by comparing the "Local:"/"Network:" URLs
  Next prints on startup (check `/aws/apprunner/<service>/<id>/application`
  in CloudWatch): both should say `localhost`/an IP, not the platform's
  internal hostname.
- **If you're on Apple Silicon, `docker build` produces an `arm64` image**,
  and App Runner's default compute is `x86_64`. An arm64 image pushed as-is
  pulls fine but can't execute at all — same `CREATE_FAILED` health-check
  symptom, except *no* application log group is ever created (the container
  never runs long enough to log anything, not even the startup banner,
  unlike the HOSTNAME issue above). Build with
  `docker buildx build --platform linux/amd64 ... --push` instead of plain
  `docker build` — see "Build and push the image" below. Verify with
  `docker buildx imagetools inspect <image>` and check for `Platform:
  linux/amd64`.
- **Commands that echo back the full service config can leak secrets** if
  you ever pass real values as plain `RuntimeEnvironmentVariables` instead
  of `RuntimeEnvironmentSecrets` (e.g. while debugging) — `create-service`
  and `describe-service` both return the complete `ImageConfiguration`
  verbatim, values included. Stick to Secrets Manager ARNs in
  `RuntimeEnvironmentSecrets` for anything sensitive, and add
  `--query 'Service.{...}'` to any command whose full output you don't need,
  so a debugging session can't accidentally print a credential into a
  terminal scrollback or log.

## One-time AWS setup

You'll need the AWS CLI configured (`aws configure` or SSO) and Docker
running locally.

```bash
# 1. An ECR repo to hold the image
aws ecr create-repository --repository-name deepam-crm

# 2. The IAM role App Runner assumes to pull from ECR (skip if you already
#    have one — it's account-wide, not per-service)
aws iam create-role \
  --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "build.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam attach-role-policy \
  --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# 3. Secrets for the two values that are actually sensitive. Everything else
#    (Clerk's publishable key, the sign-in URL, the import kill-switch) is
#    fine as a plain runtime env var — see .env.example for what each does.
aws secretsmanager create-secret --name deepam-crm/database-url \
  --secret-string "<your real Neon pooled connection string>"
aws secretsmanager create-secret --name deepam-crm/clerk-secret-key \
  --secret-string "<sk_live_xxx>"

# 4. The role the *running container* assumes to actually read those two
#    secrets at startup — separate from AppRunnerECRAccessRole above, which
#    only covers pulling the image. Note the ARNs in the inline policy below
#    have to match whatever create-secret just returned.
aws iam create-role \
  --role-name AppRunnerDeepamCrmInstanceRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'
aws iam put-role-policy \
  --role-name AppRunnerDeepamCrmInstanceRole \
  --policy-name deepam-crm-secrets-read \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "<database-url secret ARN from step 3>",
        "<clerk-secret-key secret ARN from step 3>"
      ]
    }]
  }'
```

## Build and push the image

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=<your-region>   # e.g. ap-south-1

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# --platform linux/amd64 is required if you're building on Apple Silicon (or
# any arm64 machine) — App Runner's default compute is x86_64, and an arm64
# image pulls fine but can't execute at all (see the gotcha above). buildx
# cross-compiles via QEMU emulation, which is slower than a native build
# (minutes, not seconds) but produces a real x86_64 image either way.
docker buildx build --platform linux/amd64 \
  -t "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/deepam-crm:latest" \
  --push .
```

## Create the App Runner service

`deploy/aws/apprunner-service.json` is a filled-in template — replace every
`<ACCOUNT_ID>`, `<REGION>` and the Clerk publishable key placeholder, then:

```bash
aws apprunner create-service --cli-input-json file://deploy/aws/apprunner-service.json
```

That config:

- Points at the image you just pushed, on port 3000 (matches `EXPOSE 3000` /
  `ENV PORT=3000` in the `Dockerfile`).
- Forces `HOSTNAME=0.0.0.0` and `PORT=3000` as explicit
  `RuntimeEnvironmentVariables` — required on App Runner specifically, see
  the gotcha above; the Dockerfile's own `ENV HOSTNAME=0.0.0.0` gets
  overridden by the platform otherwise.
- Wires `DATABASE_URL` and `CLERK_SECRET_KEY` from Secrets Manager
  (`RuntimeEnvironmentSecrets`) via `InstanceRoleArn` (a role the *running
  container* assumes — separate from `AccessRoleArn`, which only covers
  pulling the image) rather than as plain env vars.
- Health-checks `GET /api/health` — the one route `proxy.ts` explicitly
  leaves unauthenticated for this reason.
- `AutoDeploymentsEnabled: false` — deploys are explicit
  (`aws apprunner start-deployment`) rather than firing on every image push.
  Matches this app's own two-phase preview/commit philosophy (D-58): nothing
  goes live on the strength of "a new image landed."

`InstanceConfiguration` (1 vCPU / 2 GB) is a starting point for a two-store
internal tool (D-05), not a measured requirement — adjust after watching
real memory/CPU usage in CloudWatch.

## Environment variables reference

Same five as `.env.example`, now split by where they live:

| Variable | Where | Why |
|---|---|---|
| `DATABASE_URL` | Secrets Manager | Neon pooled connection string |
| `CLERK_SECRET_KEY` | Secrets Manager | Server-side Clerk API access |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Plain env var | Public by design; read per-request, not baked into the image |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Plain env var | `/sign-in` — without it Clerk defaults to its own hosted `*.accounts.dev` page (D-93) |
| `ALLOW_MASTER_SHEET_IMPORT` | Plain env var | Leave `false` until you deliberately want the lead-layer-replacing commit route live (D-89) |

## After the service is up

1. **Clerk dashboard → Configure → Domains/Restrictions**: add the App
   Runner service URL (`https://<id>.<region>.awsapprunner.com`, or your
   custom domain once attached) as an allowed origin. Without this, sign-in
   will fail cross-origin even with correct keys.
2. **Run migrations against the real database** before first traffic:
   `DATABASE_URL="<prod connection string>" npm run db:migrate` from your
   machine (the container never runs migrations itself — same as this app
   never auto-runs them locally).
3. **Custom domain** (optional):
   `aws apprunner associate-custom-domain --service-arn <arn> --domain-name crm.yourdomain.com`,
   then add the CNAME/validation records it returns to your DNS.

## Verify locally before touching AWS

```bash
docker build -t deepam-crm:local .
docker run -d --name deepam-crm-local -p 8080:3000 \
  -e DATABASE_URL="<real Neon connection string>" \
  -e CLERK_SECRET_KEY="<sk_...>" \
  -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="<pk_...>" \
  -e NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in" \
  deepam-crm:local

curl http://localhost:8080/api/health        # expect {"status":"ok"}
curl -I http://localhost:8080/               # expect 307 -> /sign-in

docker rm -f deepam-crm-local
```

## Redeploying after a change

```bash
# --platform linux/amd64 is required if you're building on Apple Silicon (or
# any arm64 machine) — App Runner's default compute is x86_64, and an arm64
# image pulls fine but can't execute at all (see the gotcha above). buildx
# cross-compiles via QEMU emulation, which is slower than a native build
# (minutes, not seconds) but produces a real x86_64 image either way.
docker buildx build --platform linux/amd64 \
  -t "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/deepam-crm:latest" \
  --push .
aws apprunner start-deployment --service-arn <arn-from-create-service-output>
```

`.github/workflows/deploy-aws.yml` automates the build-and-push half of this
on merges to `main` — it stops short of `start-deployment` deliberately, so
a merge builds and stages an image without ever making it live unattended.
