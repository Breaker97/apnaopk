# Deploying Storify 2.4 on Coolify

This repository upgrades the supplied v2.2 application to v2.4.0 while retaining
its custom `/api/health` route, `curl` in the runtime image, and Coolify image tag
and redeploy hook. Local `Storify-v*/` archives are not part of the application.

## Build and deployment

A push to `main` runs `.github/workflows/deploy-image.yml`:

1. Install the pinned pnpm lockfile using Node 24 and pnpm 10.24.0.
2. Run lint and TypeScript checks (Next's build skips typechecking).
3. Build Next.js, then validate dynamic chunk references.
4. Publish the prebuilt runtime image to `ghcr.io/breaker97/apnaopk:coolify`,
   alongside branch and short-commit tags.
5. Request a Coolify redeploy if both Coolify secrets are configured.

Only `main` can update the `coolify` tag or invoke its redeploy hook. The legacy
QA branch may still build, but publishes its own branch/commit tags instead.

### GitHub configuration

Under repository **Settings > Secrets and variables > Actions**, configure:

- **Variable `NEXT_PUBLIC_APP_URL`**: the public store URL (required).
- **Variables `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL`**, and applicable
  public payment, push, and analytics keys: match the production configuration.
  Browser-facing values are baked into the build; changing only Coolify's
  runtime environment does not update them.
- **Secret `COOLIFY_WEBHOOK`**: the application's deployment webhook URL from Coolify.
- **Secret `COOLIFY_TOKEN`**: a Coolify API token authorized to deploy that application.

Never commit tokens or paste them into source files. Without the two Coolify
secrets, the image is published but the workflow emits a warning and does **not**
request a Coolify redeploy. After adding them, run **Deploy image** again, or
redeploy the new image manually in Coolify.

v2.4 builds without MongoDB access. `BUILD_MONGODB_URI` is no longer consumed by
CI. Keep the real `MONGODB_URI` and other application secrets in Coolify's runtime
environment, not in the image. `deploy/Dockerfile` packages an already-built
`.next` directory; do not use it as a source-build Dockerfile in Coolify.

The Coolify resource should pull `ghcr.io/breaker97/apnaopk:coolify`, expose port
3000 through its reverse proxy, and retain persistent storage for uploaded
files. Keep the app port inaccessible directly from the public internet.
The preserved `/api/health` endpoint returns 200 only when MongoDB responds,
and 503 otherwise. Persisting `/app/.next/cache` also preserves optimized images.

## Database and storage follow-up

**The image workflow does not run migrations, seed data, or reset the database.**
Back up MongoDB and uploaded files, rehearse on a restored database, and review
migration output before applying changes to production. The upgrade crosses
both v2.3 and v2.4:

| Migration | When needed |
| --- | --- |
| `marketing-consent` | Required: convert legacy opt-in data to per-channel consent and create unsubscribe tokens/indexes. |
| `order-address-indexes` | When `MONGODB_AUTO_INDEX=false`: add v2.2/v2.3 checkout/payment and other indexes. |
| `return-refund-payer` | When vendors collect COD themselves: backfill the payer on existing returns. |
| `store-credit-indexes` | When `MONGODB_AUTO_INDEX=false`: add v2.4 credit/idempotency and other indexes. |
| `private-storage` | If existing protected files are in public object storage: configure a private bucket first, then deliberately migrate them and purge public CDN copies. |

`node scripts/migrate.mjs --list` lists the complete registry without contacting
the database. Do not indiscriminately run `--all` as an upgrade plan.

The `pnpm db:migrate` dispatcher normally requires a local `.env` file, but
Coolify supplies process environment and the image intentionally excludes `.env`.
The following **dry-run** commands work in a container terminal with the correct
runtime environment, without creating a file containing secrets:

```sh
node scripts/migrate-marketing-consent.mjs --dry-run
node scripts/migrate-order-address-indexes.mjs --dry-run
MONGODB_AUTO_INDEX=false pnpm exec tsx scripts/backfill-return-refund-payer.ts --dry-run
node scripts/migrate-store-credit-indexes.mjs --dry-run
```

Use the relevant commands only, first against the restored staging database.
Remove `--dry-run` only after approving the reports and taking a backup. Review
`scripts/migrate-private-storage.ts` separately: it moves and deletes stored
objects and is intentionally excluded from unattended migration runs.

## Runtime changes to review

- `STORAGE_PRIVATE_BUCKET`: nonpublic object storage for identity documents,
  digital deliverables, and expense receipts.
- `TRUSTED_PROXIES`: additional public proxy ranges, if applicable to the network.
- `PAGE_CACHE_MEMORY_MB`: bounded page/data cache, default 50 MB.
- `IMAGE_CACHE_DISK_MB`: optimized-image disk limit, default 1024 MB.
- For custom storage/CDN image hosts, set the repository Actions variable
  `STORAGE_PUBLIC_URL` or `CLOUDFLARE_R2_PUBLIC_URL` as well as the runtime setting
  so the build can inline the public image-optimization origin.
- The old `BUILD_NODE_HEAP_MB` and `BUILD_TURBOPACK_MEMORY_MB` controls are no
  longer used. CI sets `NODE_OPTIONS`; `BUILD_MAX_CPUS` remains supported.

`vercel.json` does not create schedules in Coolify. In addition to existing
scheduled jobs, configure authenticated requests using `CRON_SECRET` for:

- `/api/cron/checkout-expiry`: every 30 minutes (`*/30 * * * *`).
- `/api/cron/store-credit`: hourly at minute 20 (`20 * * * *`).

These endpoints change financial/inventory state; they are not health probes.

After deployment, verify the health endpoint, storefront/default-language URLs,
login, product images, cart/checkout, payment and refund flows, and SMTP delivery.
No unit/E2E test suite is included in the supplied release.
