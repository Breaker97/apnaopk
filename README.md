# Storify — Multi-Vendor E-commerce Marketplace

Storify is a full-featured, multi-vendor e-commerce marketplace built with
**Next.js 16**, **React 19**, **TypeScript**, **MongoDB/Mongoose**, and
**Tailwind CSS**. It ships with a storefront, customer accounts, vendor
dashboards, a full admin panel, staff roles, multiple payment gateways,
AI-powered tools, PWA/web-push notifications, internationalization (17
languages), and 3D product media.

This document is a complete guide to installing, configuring, running, and
deploying Storify.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [⚠️ External Service Costs & Subscriptions](#️-external-service-costs--subscriptions)
3. [Requirements](#requirements)
4. [Quick Start](#quick-start)
5. [Step-by-Step Installation](#step-by-step-installation)
6. [Environment Variables Reference](#environment-variables-reference)
7. [Database: Seeding & Resetting](#database-seeding--resetting)
8. [Default Accounts](#default-accounts)
9. [Admin Panel Configuration](#admin-panel-configuration)
10. [Integration Setup Guides](#integration-setup-guides)
11. [Finance](#finance)
12. [Internationalization (i18n)](#internationalization-i18n)
13. [Available Scripts](#available-scripts)
14. [Project Structure](#project-structure)
15. [Production Deployment](#production-deployment)
16. [Troubleshooting](#troubleshooting)
17. [Tech Stack](#tech-stack)
18. [License](#license)

---

## Feature Overview

- **Storefront** — product catalog, search, filtering, cart, checkout, blog,
  and CMS-style content pages.
- **Customer accounts** — orders, addresses, wishlists, returns/refunds,
  2FA-secured login.
- **Vendor dashboards** — product management, orders, payouts, their own
  finances (statement, expenses, what they owe the platform), staff management,
  and vendor-scoped settings.
- **Admin panel** — full control over catalog, orders, users, vendors,
  settings, payments, analytics, and notifications.
- **Staff roles** — granular, permission-based access within vendor and admin
  contexts.
- **Payments** — Stripe, PayPal, Paystack, Razorpay, Pesapal, and ioTec Pay.
- **Finance** — a double-entry ledger behind profit and loss, cash position,
  expenses, vendor statements and CSV export, with the store's own trading kept
  separate from what it earns as a marketplace. See [Finance](#finance).
- **Product boosting** — the admin sells a ladder of numbered sponsored
  positions and vendors book one for a range of days at that position's daily
  price; a revenue stream for the store owner. Off by default. See
  [`docs/PRODUCT_BOOSTING.md`](docs/PRODUCT_BOOSTING.md).
- **AI tools** — AI assistant, AI sales agent, and content generation
  (OpenAI).
- **Notifications** — transactional email (SMTP) and web-push (PWA).
- **Omnichannel messaging** — SSE live chat plus vendor/platform WhatsApp and
  Messenger connections with unified inboxes. See
  [`docs/OMNICHANNEL_MESSAGING.md`](docs/OMNICHANNEL_MESSAGING.md).
- **Internationalization** — 17 languages with RTL support.
- **3D product media** — `@google/model-viewer` for `.glb`/`.gltf` models.

---

## ⚠️ External Service Costs & Subscriptions

Some features integrate with **third-party services that may charge usage fees
or require a paid subscription**. These are optional and only active when you
configure them:

- **AI-powered tools** (AI assistant, AI sales agent, content generation) use
  the **OpenAI API**, which is **billed per token by OpenAI**. See
  <https://openai.com/api/pricing/>. You must supply your own `OPENAI_API_KEY`.
- **Plausible Analytics** integration requires access to a **Plausible
  Analytics** account/instance (a paid SaaS subscription or a self-hosted
  deployment). Configured from **Admin → Settings → Analytics**.
- **Payment gateways** (Stripe, PayPal, Paystack, Razorpay) charge
  **per-transaction fees** according to each provider's pricing.
- **Object storage** (AWS S3, Cloudflare R2, or S3-compatible) may incur
  storage and bandwidth fees per the provider's pricing.

You are responsible for any costs incurred by these external services.

---

## Requirements

| Tool        | Version                       | Notes                                              |
| ----------- | ----------------------------- | -------------------------------------------------- |
| **Node.js** | `>= 22.12.0`                  | See the `engines` field in `package.json`.         |
| **pnpm**    | `10.24.0`                     | `corepack enable` is the recommended way to get it. |
| **MongoDB** | 6 / 7                         | Local instance or hosted (e.g. MongoDB Atlas).     |
| **Git**     | any                           | To clone/manage the source.                        |

> **Why pnpm?** This project pins `packageManager` to `pnpm@10.24.0` and uses a
> `pnpm-lock.yaml`. Using npm or yarn may produce an inconsistent dependency
> tree. Enable the pinned version with:
>
> ```bash
> corepack enable
> corepack prepare pnpm@10.24.0 --activate
> ```

---

## Quick Start

For experienced users, here is the whole flow in one block:

```bash
# 1. Install dependencies
corepack enable
pnpm install

# 2. Configure environment
cp .env.example .env
# …then edit .env (see the Environment Variables Reference below)

# 3. Run
pnpm dev              # → http://localhost:3000

# 4. Open the app — it sends you straight to the installer
#    → http://localhost:3000 redirects to /en/install until setup is done
#    Picks your template, creates your admin, optionally imports a sample
#    catalog, and publishes the storefront. It locks itself when it finishes.
```

The rest of this document explains each step in detail.

> **The installer runs once.** It locks the moment your store has an admin
> account — including one made by `pnpm create-admin` or `pnpm db:seed:users`.
> Run those *instead* of the installer, not before it, or `/install` will
> answer 404 and you will have to set the store up by hand. See
> [Alternative: set up from the command line](#6-alternative-set-up-from-the-command-line).

---

## Step-by-Step Installation

### 1. Install dependencies

```bash
corepack enable          # ensures the pinned pnpm version is used
pnpm install
```

This installs all dependencies and runs approved build scripts (`sharp`,
`esbuild`, `@swc/core`, etc.) listed under `pnpm.onlyBuiltDependencies` in
`package.json`.

### 2. Set up MongoDB

You need a running MongoDB instance. Pick **one** of:

- **Local (Docker)** — quickest for development:

  ```bash
  docker run -d --name storify-mongo -p 27017:27017 mongo:7
  ```

  Then use `MONGODB_URI=mongodb://localhost:27017/storify`.

- **Local (native install)** — install MongoDB Community Server and start the
  `mongod` service.

- **Hosted (MongoDB Atlas)** — create a free cluster at
  <https://www.mongodb.com/atlas>, add your IP to the network access list,
  create a database user, and copy the connection string into `MONGODB_URI`.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the values. The **minimum required** variables to boot
the app are:

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `MONGODB_URI`        | MongoDB connection string.                                     |
| `MONGODB_DB_NAME`    | Database name (e.g. `storify`).                                |
| `BETTER_AUTH_SECRET` | Random 32+ char secret. Generate: `openssl rand -base64 32`.   |
| `BETTER_AUTH_URL`    | Base auth URL — `http://localhost:3000` in dev.                |
| `NEXT_PUBLIC_APP_URL`| Public app URL — `http://localhost:3000` in dev.               |

Everything else (SMTP, payments, AI, web push, storage) is optional and only
needed for the features you intend to use. See the
[full reference](#environment-variables-reference) below.

### 4. Run the development server

```bash
pnpm dev
```

Leave it running — the installer in the next step is a page in the app itself.
Until you finish it **every page redirects to the installer**, so you cannot
land on an empty storefront by accident.

### 5. Set your store up — the installer

Open <http://localhost:3000> — an unconfigured store redirects to
`/en/install` — and follow the five steps:

| Step | What it does |
| --- | --- |
| **System check** | Node version (22.12.0 or newer), `BETTER_AUTH_SECRET` strength, app URL, database. Node, the auth secret and the database **block** the install (they are what the finish step needs); the app URL is a warning you can fix later — `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` must be the address you open the installer on, or signing in there fails. "Check again" re-runs them; restart the app after editing `.env`, and rebuild after changing `NEXT_PUBLIC_APP_URL` |
| **Admin account** | Your super-admin — name, email, password (checked against the active password policy) |
| **Store basics** | Store name, default language, currency, single- or multi-vendor, point of sale |
| **Media storage** | The bucket product images, videos and downloads are uploaded to — Cloudflare R2, AWS S3, DigitalOcean Spaces or MinIO — with a "Test connection" that also proves the files come back over the public URL. Skippable ("Set storage up later"), and pre-skipped when `.env` already carries `STORAGE_*` credentials |
| **Template** | Electronics (default), Women Fashion or Classic Marketplace, plus an optional sample store — that template's own demo catalog, collections and storefront |

Finishing publishes the chosen template across the storefront — home, product
page, header and footer — and hands you a link to sign in.

> **⚠️ The installer runs exactly once.** It locks as soon as the store has an
> admin account, and from then on `/install` and every `/api/install/*` route
> answer a plain **404**. That is deliberate — a reachable installer on a live
> store is how storefronts get taken over. It also means an admin created any
> other way (`pnpm create-admin`, `pnpm db:seed:users`) closes the installer
> permanently, so pick one path or the other.

Nothing is lost if you change your mind later: **Admin → Online Store →
Themes** switches template at any time, and switching only replaces the
layout — products, orders and settings stay exactly where they are.

### 6. Alternative: set up from the command line

For development, CI, or restoring an existing database, you can skip the
installer entirely. Do **not** mix the two — running either command below
before visiting `/install` locks the installer.

```bash
# Sample catalog, settings, and a published Electronics storefront
pnpm db:seed

# Sample admin / vendor / staff / customer accounts
pnpm db:seed:users

# …or just your own admin, with no sample data
pnpm create-admin <email> [password] [name]
pnpm create-admin admin@your-store.com
```

The email is required. If the password or name arguments are omitted, the
script falls back to `ADMIN_PASSWORD` / `ADMIN_NAME` from `.env`; if no
password is available at all, a random one is generated and printed. Running
it with the email of an existing user upgrades that user to admin.

> `pnpm create-admin` on its own leaves the storefront on its built-in
> starter layout with no catalog. Publish a template afterwards from
> **Admin → Online Store → Themes** ("Use this template"), or run
> `pnpm db:seed` first, which does it for you.

### 7. Where to go next

Key entry points:

- **Storefront** — `http://localhost:3000/en`
- **Admin panel** — `http://localhost:3000/en/admin`
- **Vendor dashboard** — `http://localhost:3000/en/vendor`
- **Staff dashboard** — `http://localhost:3000/en/staff`

(`en` is the default locale — see [Internationalization](#internationalization-i18n).)
---

## Environment Variables Reference

All variables live in `.env` (copied from `.env.example`). Variables prefixed
with `NEXT_PUBLIC_` are exposed to the browser.

> **Two sources of config:** integration credentials (payments, OAuth/social
> login, SMTP, storage, analytics) can be set either in `.env` **or** in
> **Admin → Settings**. A value saved in Settings (database) always wins; the
> matching `.env` variable is the per-field fallback. This lets you boot from
> `.env` and later override individual fields from the UI.

### Database (required)

| Variable          | Example                                            | Description                |
| ----------------- | -------------------------------------------------- | -------------------------- |
| `MONGODB_URI`     | `mongodb://localhost:27017/storify?...`            | MongoDB connection string. |
| `MONGODB_DB_NAME` | `storify`                                          | Database name.             |

### Authentication — Better Auth (required)

| Variable             | Example                       | Description                                       |
| -------------------- | ----------------------------- | ------------------------------------------------- |
| `BETTER_AUTH_SECRET` | `…32+ random chars…`          | Signing secret. `openssl rand -base64 32`.        |
| `BETTER_AUTH_URL`    | `http://localhost:3000`       | Base URL Better Auth uses for callbacks.          |

### OAuth / Social login (optional)

Also configurable in **Admin → Settings → OAuth**. When credentials are
supplied via `.env` only, the provider is enabled automatically without
toggling it on in the Admin panel.

| Variable               | Description                  |
| ---------------------- | ---------------------------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID.      |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret.  |
| `FACEBOOK_APP_ID`      | Facebook app ID.             |
| `FACEBOOK_APP_SECRET`  | Facebook app secret.         |

### App configuration (required)

| Variable                        | Example                  | Description                                       |
| ------------------------------- | ------------------------ | ------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`           | `http://localhost:3000`  | Public-facing app URL.                            |
| `NEXT_PUBLIC_APP_NAME`          | `Storify`                | Brand name shown in the UI.                       |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | `support@example.com`    | Support contact email.                            |
| `DEMO_MODE`                     | `false`                  | Set to `true` on public demos. Creates, updates and image uploads still work; deletes, settings/profile edits and test actions are refused. |
| `NEXT_PUBLIC_ENABLE_PWA_IN_DEV` | `false`                  | Enable the PWA/service worker in local dev.       |

> Multi-vendor marketplace mode is toggled at runtime from **Admin → Settings
> → Multi-vendor** (stored in the database), not via an environment variable.

### Initial admin account (fallbacks for `pnpm create-admin`)

Used when the optional `[password]` / `[name]` arguments are omitted from
`pnpm create-admin <email> [password] [name]`.

| Variable           | Example                | Description                                  |
| ------------------ | ---------------------- | -------------------------------------------- |
| `ADMIN_NAME`       | `Admin`                | Display name for the created admin.          |
| `ADMIN_PASSWORD`   | `change-me`            | Password for the created admin.              |

### OpenAI — AI assistant / content tools (optional)

| Variable                 | Description                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`         | API key for AI features. **Billed per token by OpenAI.** Leave blank to disable.                                                                       |
| `AI_HERO_BANNER_ENABLED` | Set to `true` to enable admin Hero banner generation. Requires `OPENAI_API_KEY`; defaults to disabled and does not affect other AI authoring features. |

### Web Push notifications (optional)

Generate the key pair with `pnpm push:keys`, then set:

| Variable                          | Description                                            |
| --------------------------------- | ------------------------------------------------------ |
| `WEB_PUSH_PUBLIC_KEY`             | VAPID public key.                                      |
| `WEB_PUSH_PRIVATE_KEY`            | VAPID private key.                                     |
| `WEB_PUSH_SUBJECT`                | `mailto:` contact for push service (e.g. admin email). |
| `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY` | Same public key, exposed to the browser.               |

### Email / SMTP (required for transactional emails)

| Variable    | Example                              | Description                |
| ----------- | ------------------------------------ | -------------------------- |
| `SMTP_HOST` | `smtp.example.com`                   | SMTP server host.          |
| `SMTP_PORT` | `587`                                | SMTP port.                 |
| `SMTP_USER` | `your-smtp-username`                 | SMTP username.             |
| `SMTP_PASS` | `your-smtp-password`                 | SMTP password.             |
| `SMTP_FROM` | `"Storify <no-reply@example.com>"`   | Default "From" address.    |

### Payment gateways (optional)

Configure only the providers you use. **Each charges transaction fees.**

**Stripe** — <https://stripe.com/pricing>

| Variable                              | Description                |
| ------------------------------------- | -------------------------- |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`  | Publishable (browser) key. |
| `STRIPE_SECRET_KEY`                   | Secret (server) key.       |
| `STRIPE_WEBHOOK_SECRET`               | Webhook signing secret.    |

**PayPal** — <https://www.paypal.com/us/webapps/mpp/merchant-fees>

| Variable               | Description                |
| ---------------------- | -------------------------- |
| `PAYPAL_CLIENT_ID`     | PayPal client ID.          |
| `PAYPAL_CLIENT_SECRET` | PayPal client secret.      |
| `PAYPAL_WEBHOOK_ID`    | PayPal webhook ID (used to verify webhook events). |

**Paystack** — <https://paystack.com/pricing>

| Variable                          | Description                |
| --------------------------------- | -------------------------- |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Public (browser) key.      |
| `PAYSTACK_PUBLIC_KEY`             | Public key (server).       |
| `PAYSTACK_SECRET_KEY`             | Secret key.                |

**Razorpay** — <https://razorpay.com/pricing/>

| Variable                        | Description                |
| ------------------------------- | -------------------------- |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`   | Key ID (browser).          |
| `RAZORPAY_KEY_ID`               | Key ID (server).           |
| `RAZORPAY_KEY_SECRET`           | Key secret.                |
| `RAZORPAY_WEBHOOK_SECRET`       | Webhook signing secret.    |

### Object storage (optional)

Works with AWS S3, Cloudflare R2, or any S3-compatible provider. Also
configurable from **Admin → Settings → Storage** (database values override
these per field).

- **Cloudflare R2:** set `STORAGE_ENDPOINT` to the R2 S3 API endpoint
  (`https://<account-id>.r2.cloudflarestorage.com`) and `STORAGE_REGION=auto`.
- **AWS S3:** set `STORAGE_REGION` (e.g. `us-east-1`) and leave
  `STORAGE_ENDPOINT` blank.

| Variable                    | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `STORAGE_ACCESS_KEY_ID`     | Access key ID.                                               |
| `STORAGE_SECRET_ACCESS_KEY` | Secret access key.                                           |
| `STORAGE_ACCOUNT_ID`        | Account ID (Cloudflare R2 only).                             |
| `STORAGE_ENDPOINT`          | S3 API endpoint (R2 / S3-compatible; blank for AWS S3).      |
| `STORAGE_REGION`            | Region (`auto` for R2, e.g. `us-east-1` for AWS).            |
| `STORAGE_BUCKET`            | Bucket name.                                                 |
| `STORAGE_PUBLIC_URL`        | Public base URL / CDN for serving uploaded files.            |
| `CLOUDFLARE_R2_PUBLIC_URL`  | Legacy fallback for the R2 public URL (if `STORAGE_PUBLIC_URL` is unset). |

### Analytics / tracking (optional)

Also configurable from **Admin → Settings → Analytics**. The `NEXT_PUBLIC_*`
IDs are exposed to the browser for client-side tracking scripts.

| Variable                        | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_GA_ID`             | Google Analytics measurement ID (`G-…`).               |
| `NEXT_PUBLIC_GTM_ID`            | Google Tag Manager container ID (`GTM-…`).             |
| `NEXT_PUBLIC_FACEBOOK_PIXEL_ID` | Facebook (Meta) Pixel ID.                              |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID`   | TikTok Pixel ID.                                       |
| `PLAUSIBLE_API_KEY`             | Plausible API key (server-side; admin analytics dashboard). |

---

## Database: Seeding & Resetting

| Command               | What it does                                                |
| --------------------- | ----------------------------------------------------------- |
| `pnpm db:seed`        | Seeds sample catalog and default settings.                  |
| `pnpm db:seed:users`  | Seeds demo accounts (admin/vendor/staff/customer).          |
| `pnpm db:reset`       | **Drops/resets** the database. Destructive.                 |
| `pnpm db:full-reset`  | Resets, then re-seeds the catalog & settings.               |

> ⚠️ `db:reset` and `db:full-reset` are destructive — they wipe data. Never run
> them against a production database.

See `docs/DATABASE_COMMANDS.md` and `docs/SEED_VERIFICATION.md` for more detail.

### Upgrading an existing database

`user.status` is now enforced for **every** role — a `banned` or `inactive`
account is refused a session whether it belongs to a shopper, a vendor, a staff
member, or an administrator. Before, the check covered only customers and
vendors, so for the other roles the value was written but never read and may
hold something nobody intended.

Run this once after upgrading, so a stray value does not lock you out of your
own dashboard:

```bash
pnpm db:migrate account-status --dry-run # report what would change
pnpm db:migrate account-status           # reactivate admin/staff/seller accounts
```

Locked out already? `pnpm create-admin <email>` reactivates and re-promotes a
single account.

**Product boosting** adds three more one-time migrations. Run them if you are
upgrading an existing database — the feature is inert without the first, and
non-Stripe vendor renewals are billed in the wrong currency without the second:

```bash
pnpm db:migrate boosts                # indexes for sponsored placements
pnpm db:migrate boost-permissions     # grant view_boosts/manage_boosts to existing vendors
pnpm db:migrate subscription-currency # repair plan snapshots stamped "USD"
```

Each accepts a `:dry` variant that reports without writing. Vendor permissions
are materialized per row at creation, so existing vendors do **not** pick up new
permission keys from a code upgrade — without that migration they get
"forbidden" on Vendor → Boosts.

If you ran a pre-release build that sold flat-fee boost *packages*, clear what
it left behind once — those rows carry no position and no booked days, so every
lifecycle path reads as broken while they sit there:

```bash
pnpm db:migrate drop-boost-packages --dry-run # report only
pnpm db:migrate drop-boost-packages
```

**Renaming the store** in Settings → General now really does rename it
everywhere. The demo seeder used to copy the sample brand into an SEO meta title
and an email sender name, and both outrank the store name — so the browser tab,
link previews and outbound mail kept saying "Storify" no matter what the store
was called. Those two repair themselves on the next boot. The seeded *page*
titles ("Electronics - Storify" on categories, collections, brands and posts) are
content rows, so clear them once:

```bash
pnpm db:migrate debrand --dry-run # report only
pnpm db:migrate debrand
```

It only rewrites values that still match what the seeder shipped — a title you
wrote yourself is left alone — and it is a no-op on a store that was never
seeded with the demo catalog.

**Finance** needs one backfill on an existing store. The ledger starts empty, so
without it every report begins the day you upgraded and the whole section looks
broken rather than new:

```bash
pnpm db:migrate ledger --dry-run # counts what it would post, writes nothing
pnpm db:migrate ledger           # replays paid orders, refunds, payouts, labels
```

Safe to run repeatedly — entry keys come from the source documents, so a second
run collides with itself and writes nothing. See [Finance](#finance) for what to
do when a figure needs correcting afterwards.

**If you already ran that backfill on an earlier version**, run it once more
with `--rebuild`. The order and refund rules have since changed — duty and a
free-shipping coupon are taken out of the merchandise a vendor is paid for, a
refund reverses each part where it came from, and a part-paid pre-order no
longer books cash that has not arrived. Entries written under the old rules keep
their keys, so only a rebuild replaces them:

```bash
pnpm db:migrate ledger --dry-run -- --rebuild
pnpm db:migrate ledger -- --rebuild
```

The same run also re-files unpaid expenses off `vendor_payable` and posts the
subscription invoices billed through Stripe's own engine, neither of which the
ledger used to carry.

---

## Default Accounts

Running `pnpm db:seed:users` creates these demo accounts. **Change or remove
them before going to production.**

| Role     | Email                  | Password       |
| -------- | ---------------------- | -------------- |
| Admin    | `admin@storify.com`    | `Admin@123`    |
| Vendor   | `vendor@storify.com`   | `Vendor@123`   |
| Staff    | `staff@storify.com`    | `Staff@123`    |
| Customer | `customer@storify.com` | `Customer@123` |

The login page shows these credentials only when the deployment runs with
`DEMO_MODE=true` (see `.env.example`). On a normal install the card is hidden —
never enable demo mode on a real store.

---

## Admin Panel Configuration

Many settings are managed at runtime through the admin UI and stored in the
database (not `.env`). After logging in as an admin, visit **Admin → Settings**:

- **Storage** — connect AWS S3 / Cloudflare R2 / S3-compatible buckets for
  media uploads.
- **Payments** — enable/disable gateways and toggle test/live mode.
- **Email / Notifications** — configure transactional email and
  per-event/admin notification preferences.
- **Analytics** — connect a Plausible Analytics instance.
- **Multi-vendor** — toggle marketplace mode
  (`settings.multiVendorMode.enabled`). This is the only switch for
  multi-vendor mode; there is no environment variable for it.

---

## Integration Setup Guides

### Web Push (PWA notifications)

1. Generate a VAPID key pair:

   ```bash
   pnpm push:keys
   ```

2. Copy the printed public/private keys into `WEB_PUSH_PUBLIC_KEY`,
   `WEB_PUSH_PRIVATE_KEY`, and `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`.
3. Set `WEB_PUSH_SUBJECT` to a `mailto:` address.
4. To test the PWA/service worker locally, set
   `NEXT_PUBLIC_ENABLE_PWA_IN_DEV=true`.

### Stripe webhooks

Point your Stripe webhook endpoint at `/<your-app-url>/api/payments/webhook`
and put the signing secret in `STRIPE_WEBHOOK_SECRET`. For local testing, use
the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

### Shipping carriers (Shippo / Shiprocket)

Connect a carrier account in **Admin > Settings > Shipping > Shipping carriers**
to buy real labels, print AWBs and sync tracking from the order page — manually
or automatically once an order is paid and moved to processing. Checkout keeps
using your own zones and rates.

Shippo needs a token (test and live are different strings; there is no sandbox
host). Shiprocket needs an API-user login **and** a pickup-location nickname
registered in their dashboard, and only dispatches from India.
**Live tokens buy real labels and are billed to your carrier account.**

Automation and tracking sync need `CRON_SECRET` and the two cron entries in
`vercel.json`. Full setup, webhook verification and troubleshooting:
[`docs/AUTOMATED_SHIPPING_CARRIERS.md`](docs/AUTOMATED_SHIPPING_CARRIERS.md).

### OpenAI (AI features)

Set `OPENAI_API_KEY`. Leaving it blank disables the AI assistant, AI sales
agent, and AI content generation without breaking the rest of the app.
**Usage is billed per token by OpenAI.**

Hero banner generation has an independent kill switch: set
`AI_HERO_BANNER_ENABLED=true` after configuring `OPENAI_API_KEY`. Turning the
switch off leaves Product, Category, Collection, Brand, and Blog AI Studio
features unchanged.

---

## Finance

**Admin > Finance** reports money from a double-entry ledger rather than by
re-counting orders. Every paid order, refund, payout, expense, boost payment and
carrier label posts a pair of entries, and the profit and loss, cash position
and vendor balances are groupings of those entries — so two screens cannot
disagree about the same sale.

Three things worth knowing before you rely on it:

**Two books, and they are never added together.** `own` is the store's own
stock, where the shop is the seller and books full revenue and cost of goods.
`marketplace` is what is earned as an agent — commission, subscriptions, boosts
— where a vendor's share is money held on their behalf and never revenue.
Turning multi-vendor mode off means the marketplace book is simply never
written to, and the Finance screens show one book.

**Currencies are never summed.** Every total is grouped by the currency it was
recorded in. If a figure is missing from a report, look for it under its own
currency rather than expecting a converted total.

**Nothing is edited, only reversed.** Correcting or deleting an expense posts a
mirror entry rather than changing the original, so a report you ran last month
still produces last month's answer. Closing a month (**Finance > Reports**)
works the same way: it does not lock any data, it redirects entries that arrive
late into the open month with a note saying where they belong.

**One currency at a time, everywhere.** A payout moves money in the currency the
sales were made in, not the store's current default, and a period spanning two
currencies is refused rather than added together. Balances in a currency a
screen cannot show are named on it, so nothing goes uncollected quietly.

**A refund that lands after a payout is recovered from the next one.** A payout
is final and a refund is not, so a shopper returning goods a month after the
vendor was paid leaves the platform out of pocket. The difference is carried
forward as an **Adjustment** on the next payout — never more than that payout is
worth, with the remainder coming off the one after — and shown on the vendor's
payout detail so the deduction is never an unexplained gap.

**Not everything in a total is revenue.** An order's total is split into four
parts before anything is posted — goods, delivery, tax and import duty — and
each lands in its own account. Tax and duty are liabilities, owed onward to the
state and to customs; only the goods are shared with a vendor. Delivery is the
platform's income in both books, so a refund takes it back off shipping income
rather than out of the vendor's balance. A part-paid pre-order posts the sale in
full and the uncollected balance as **Owed by customers**, so the cash accounts
hold only what has actually arrived.

### Recurring expenses

Rent, salaries and hosting can be recorded once with **Repeats** switched on.
The daily `/api/cron/finance` job creates each copy when it falls due, dated
when it was due rather than when the job ran — so a cron that was down for two
months produces both months, not one row dated today. Needs `CRON_SECRET` and
the cron entry already present in `vercel.json`; without the secret the endpoint
answers 401 and no copy is ever created.

### When a posting rule changes

Ledger keys are derived from the source document, which makes replays safe and
has one consequence worth knowing: an entry written under an older rule keeps
its key, so a plain re-run of the backfill collides with it and the old figure
survives. After a fix that changes how something posts, rebuild the affected
slice instead:

```bash
pnpm db:migrate ledger --dry-run -- --rebuild --method=cod # counts, writes nothing
pnpm db:migrate ledger -- --rebuild --method=cod
```

`--rebuild` deletes the order and refund entries in scope and posts them again.
On any other day it deletes good data to write the same thing back, which is why
it is a separate flag. Run the `:dry` form first, always.

Omit `--method` to rebuild every order. That is what an upgrade wants when the
order or refund rules themselves changed:

```bash
pnpm db:migrate ledger --dry-run -- --rebuild
pnpm db:migrate ledger -- --rebuild
```

The run ends by printing the trial balance, and exits non-zero if it is not
zero — so a rebuild that went wrong says so rather than leaving you to find it
in a report.

---

## Internationalization (i18n)

Storify ships with **17 locales** (config in `config/i18n.config.ts`,
translations in `locales/*.json`). The default locale is **`en`**, and Arabic
(`ar`) renders right-to-left.

| Code | Language        | Code | Language          | Code | Language        |
| ---- | --------------- | ---- | ----------------- | ---- | --------------- |
| `en` | English (US)    | `de` | German            | `af` | Afrikaans       |
| `bn` | Bengali         | `hi` | Hindi             | `sw` | Swahili         |
| `ar` | Arabic (RTL)    | `nl` | Dutch             | `ha` | Hausa           |
| `es` | Spanish         | `zh` | Chinese (Simpl.)  | `yo` | Yoruba          |
| `fr` | French          | `ja` | Japanese          | `ig` | Igbo            |
|      |                 | `zu` | Zulu              | `xh` | Xhosa           |

Routes are locale-prefixed (e.g. `/en/admin`, `/ar/admin`).

---

## Available Scripts

| Script                 | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `pnpm dev`             | Start the Next.js dev server.                     |
| `pnpm build`           | Production build.                                 |
| `pnpm start`           | Start the production server (after `build`).      |
| `pnpm lint`            | Run ESLint.                                       |
| `pnpm typecheck`       | Run the TypeScript compiler (no emit).            |
| `pnpm create-admin`    | Create an admin user.                             |
| `pnpm link-credential` | Link a credential account to a user.              |
| `pnpm db:seed`         | Seed catalog & settings.                          |
| `pnpm db:seed:users`   | Seed sample users.                                |
| `pnpm db:reset`        | Reset the database (destructive).                 |
| `pnpm db:full-reset`   | Reset, then re-seed.                              |
| `pnpm db:migrate --list` | List every upgrade migration and what it does.    |
| `pnpm db:migrate <name>` | Run one — add `--dry-run` to report only.         |
| `pnpm push:keys`       | Generate VAPID keys for web push.                 |

---

## Project Structure

```
.
├── app/                 # Next.js App Router
│   ├── [locale]/        # Locale-prefixed routes
│   │   ├── (auth)/      # Login, register, 2FA
│   │   ├── (store)/     # Storefront, blog, content pages
│   │   ├── admin/       # Admin panel
│   │   ├── vendor/      # Vendor dashboard
│   │   └── staff/       # Staff dashboard
│   └── api/             # Route handlers (payments, media, webhooks, …)
├── components/          # UI and feature components
├── config/             # App, branding, i18n, permissions config
├── docs/                # Internal docs & analysis
├── hooks/              # React hooks
├── lib/                # Server/client utilities, integrations
├── locales/            # i18n translation JSON (17 languages)
├── models/             # Mongoose models
├── providers/          # React context providers
├── public/             # Static assets, service worker
├── scripts/            # Admin/seed/reset CLI scripts
└── stores/             # Zustand state stores
```

---

## Production Deployment

1. Set **all required** environment variables for your production environment.
   In particular, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must point to your
   production domain (HTTPS).
2. Use a strong, unique `BETTER_AUTH_SECRET`.
3. Use a managed/hardened MongoDB instance (e.g. Atlas) and a production
   `MONGODB_URI`.
4. Build and start:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   pnpm start
   ```

5. Configure provider webhooks (Stripe, Razorpay, etc.) to point at your
   production domain.
6. **Remove or change all default seed accounts** and any test API keys.

> **Node version:** ensure the production runtime uses Node `>= 22.12.0`.
> Node 20 reached end of life in April 2026 and no longer receives security
> fixes. Node 24 LTS is recommended; `.nvmrc` pins it for local development.

> **Deploying to Vercel or another serverless platform?** See
> [docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md) — a few settings there
> are not optional, and one of them silently disables background jobs if missed.

---

## Troubleshooting

| Symptom                                    | Likely cause / fix                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| App won't boot / auth errors               | Missing `MONGODB_URI`, `BETTER_AUTH_SECRET`, or `BETTER_AUTH_URL` in `.env`.        |
| `MongoServerError` / connection refused    | MongoDB not running, wrong `MONGODB_URI`, or IP not allow-listed in Atlas.          |
| Wrong pnpm version / install mismatches    | Run `corepack enable && corepack prepare pnpm@10.24.0 --activate`.                  |
| AI features do nothing                     | `OPENAI_API_KEY` not set (this is expected if you don't use AI).                    |
| Emails not sending                         | Verify `SMTP_*` values; check provider auth and port (587 STARTTLS / 465 SSL).      |
| Push notifications not working             | Generate keys with `pnpm push:keys` and set all `WEB_PUSH_*` vars; HTTPS required.  |
| Service worker not active in dev           | Set `NEXT_PUBLIC_ENABLE_PWA_IN_DEV=true`.                                            |
| Payment webhooks not received              | Confirm the webhook URL and signing secret match your provider dashboard.           |

---

## Tech Stack

- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript
- **Database:** MongoDB · Mongoose
- **Auth:** Better Auth (sessions, 2FA)
- **UI:** Tailwind CSS · Radix UI · Lucide icons
- **Content/media:** TipTap (rich text) · Recharts · `@google/model-viewer` (3D)
- **Payments:** Stripe · PayPal · Paystack · Razorpay
- **i18n:** next-intl (17 languages, RTL)
- **Notifications:** Web Push (PWA) · Nodemailer (SMTP)
- **AI:** OpenAI
- **State:** Zustand · React Hook Form · Zod
- **Tooling:** ESLint

---

## License

Distributed under your CodeCanyon/Envato license. See the item license for
details.
