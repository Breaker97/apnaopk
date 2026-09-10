# Deploy Storify on Coolify

Storify is best deployed as a prebuilt image. Its production build needs a
reachable MongoDB and several GB of memory, so the included GitHub Actions
workflow builds on a GitHub runner and Coolify only pulls and runs the result.

## 1. Create the database

Use MongoDB Atlas or another production MongoDB 6/7 instance that GitHub
Actions and the Coolify server can both reach. Create a database user and keep
the connection string. It should include the database name, for example:

```text
mongodb+srv://USER:PASSWORD@CLUSTER/storify?retryWrites=true&w=majority
```

If Atlas network access is restricted, allow both GitHub-hosted runners and the
Coolify server. GitHub runner addresses change, so a fixed allow-list requires
a self-hosted runner; otherwise use Atlas network rules appropriate for your
security model and rely on strong database credentials.

## 2. Put the project in GitHub

Push this directory to a GitHub repository. The workflow runs for `main` and
`version-2.0-qa`, and can also be started manually from the Actions tab.

In **GitHub > Settings > Secrets and variables > Actions**, add:

Repository secrets:

| Name | Value |
| --- | --- |
| `BUILD_MONGODB_URI` | The production MongoDB connection string |

Repository variables:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://store.example.com` |
| `NEXT_PUBLIC_APP_NAME` | Store name, for example `Storify` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public support address |

Run **Actions > Deploy image > Run workflow**. It publishes:

```text
ghcr.io/OWNER/REPOSITORY:coolify
```

Package names are lowercase. Make the GHCR package public for the simplest
setup. To keep it private, create a GitHub token with `read:packages` and run
this as the same Linux user configured for the Coolify server:

```bash
printf '%s' 'YOUR_GITHUB_TOKEN' | docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin
```

## 3. Create the Coolify application

1. Open the target Coolify project and environment.
2. Select **New resource > Docker Image**.
3. Enter `ghcr.io/OWNER/REPOSITORY:coolify` as the image.
4. Set **Ports Exposes** to `3000`.
5. Add the production domain and enable HTTPS.
6. Configure the health check path as `/api/health` on port `3000`.
7. Add persistent directory mounts if local file storage will be used:
   - `/app/public/uploads`
   - `/app/private-uploads`
   - `/app/.next/cache/images` (recommended image-optimization cache)

Do not mount the whole `/app` or `/app/.next` directory; doing so hides files
that are part of the image.

## 4. Add runtime environment variables

Add these in the application's Coolify **Environment Variables** screen:

```dotenv
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/storify?retryWrites=true&w=majority
MONGODB_DB_NAME=storify
BETTER_AUTH_SECRET=REPLACE_WITH_A_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS
BETTER_AUTH_URL=https://store.example.com
NEXT_PUBLIC_APP_URL=https://store.example.com
NEXT_PUBLIC_APP_NAME=Storify
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
DEMO_MODE=false
```

Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`. The URL and every
`NEXT_PUBLIC_*` value must match the values used by GitHub Actions because
public variables are compiled into the browser bundle.

SMTP, object storage, payments, OAuth, analytics, web push, and AI are optional
at first and can be configured later. See `.env.example` for all supported
variables. For production media, S3-compatible object storage is preferred;
if local storage is used, keep both upload mounts above and include them in
Coolify backups.

## 5. Deploy and finish installation

Click **Deploy**. When `/api/health` returns HTTP 200, open the public domain.
The installation wizard creates the first administrator and initial store
settings. Complete it immediately; it locks itself after installation.

## 6. Optional automatic redeploys

Enable API access in Coolify and create an API token. Copy the application's
deploy webhook URL, then add these GitHub Actions repository secrets:

| Name | Value |
| --- | --- |
| `COOLIFY_WEBHOOK` | The application's Coolify deploy webhook URL |
| `COOLIFY_TOKEN` | Coolify API token |

After every successful image build, the workflow asks Coolify to pull the new
`coolify` tag and replace the running container.

## Troubleshooting

- **GitHub build cannot connect to MongoDB:** fix Atlas/network allow-listing
  and confirm `BUILD_MONGODB_URI` includes valid credentials.
- **Coolify cannot pull the image:** make the GHCR package public or authenticate
  Docker on the Coolify server with a `read:packages` token.
- **Container is unhealthy:** inspect Coolify logs, then verify `MONGODB_URI`,
  `MONGODB_DB_NAME`, DNS, and database network access from the server.
- **Authentication fails:** ensure `BETTER_AUTH_SECRET` is at least 32 random
  characters and both app URLs exactly match the HTTPS domain.
- **Old branding or public keys after changing environment variables:** update
  the matching GitHub repository variables and rebuild the image; runtime-only
  changes cannot replace values already compiled into client JavaScript.
