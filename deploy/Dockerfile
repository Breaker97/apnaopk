# syntax=docker/dockerfile:1
# Runtime image for a PREBUILT Storify. `pnpm build` runs on the CI runner
# (.github/workflows/deploy-image.yml) and the resulting .next/ arrives via
# the build context — this file only assembles the runtime, it NEVER
# compiles. Compiling inside `docker build` is deliberately avoided: the
# compile needs several GB of RAM and a reachable MongoDB, neither of which
# belongs on the server that also runs the store.
#
# It lives under deploy/ (not the repo root) on purpose: some deploy panels
# auto-prefer a root Dockerfile over their source build, and this one is only
# valid when CI has already built the app. For on-server deploys keep using
# Nixpacks — docs/UPGRADE.md -> "Build requirements". Full pipeline docs:
# docs/DEPLOYMENT_PREBUILT_IMAGE.md
FROM node:24-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack picks up the pinned pnpm version from package.json's packageManager
RUN corepack enable

WORKDIR /app

# Dependency layer first, so a rebuild that only changed source reuses it.
# NODE_ENV is set only after installing: the dev dependencies (tsx above all)
# must be present at runtime for `pnpm create-admin` and the `pnpm db:migrate`
# commands to work from a container terminal, exactly as on a source deploy.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
RUN pnpm install --frozen-lockfile --prod=false

# Full source plus the prebuilt .next from the runner (.dockerignore keeps
# .next/cache, env files and .git out).
COPY . .

# Refuse to produce an image that would only crash at `next start`.
RUN test -f .next/BUILD_ID || { \
      echo "ERROR: no prebuilt .next/ in the build context." ; \
      echo "This Dockerfile packages an app that CI already built; it never compiles." ; \
      echo "Run the deploy-image workflow (docs/DEPLOYMENT_PREBUILT_IMAGE.md) or use Nixpacks for on-server builds." ; \
      exit 1 ; \
    }

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
