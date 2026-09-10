"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { STORAGE_PROVIDER_LABELS } from "@/lib/storage/types";
import type { StorageProvider } from "@/components/admin/storage-provider-toggle";

/**
 * The account-setup checklist for the selected provider, plus the one thing a
 * store owner has to do that no form can do for them: move the media that is
 * already on disk.
 *
 * Local storage was retired in v1.5, so every install now has to reach an
 * object-storage provider before it can accept a single upload — and two of the
 * four (MinIO, DigitalOcean Spaces) are new enough that nobody has done them
 * before. The steps are here rather than only in `docs/STORAGE_SETUP.md`
 * because they are needed at exactly the moment the fields above are empty.
 */

/** A step, with an optional command or config fragment shown verbatim. */
interface GuideStep {
  key: string;
  fallback: string;
  code?: string;
}

/** Where the provider's own dashboard lives. MinIO has none — it is software. */
const CONSOLE: Record<
  StorageProvider,
  { url: string; key: string; fallback: string }
> = {
  cloudflare_r2: {
    url: "https://dash.cloudflare.com/?to=/:account/r2",
    key: "setup.console.cloudflare_r2",
    fallback: "Open the Cloudflare dashboard",
  },
  s3: {
    url: "https://s3.console.aws.amazon.com/s3/buckets",
    key: "setup.console.s3",
    fallback: "Open the AWS S3 console",
  },
  minio: {
    url: "https://min.io/docs/minio/container/index.html",
    key: "setup.console.minio",
    fallback: "Open the MinIO install guide",
  },
  digitalocean: {
    url: "https://cloud.digitalocean.com/spaces",
    key: "setup.console.digitalocean",
    fallback: "Open DigitalOcean Spaces",
  },
};

const SETUP: Record<
  StorageProvider,
  { steps: GuideStep[]; caution: { key: string; fallback: string } }
> = {
  cloudflare_r2: {
    steps: [
      {
        key: "setup.cloudflare_r2.bucket",
        fallback:
          "In the Cloudflare dashboard open R2 → Create bucket. Its name goes in Bucket Name above.",
      },
      {
        key: "setup.cloudflare_r2.token",
        fallback:
          "R2 → Manage R2 API Tokens → Create API token, permission Object Read & Write, scoped to that bucket. Copy both halves into Access Key ID and Secret Access Key — the secret is shown once.",
      },
      {
        key: "setup.cloudflare_r2.account",
        fallback:
          "Copy the 32-character Account ID from the R2 overview sidebar into R2 Account ID.",
      },
      {
        key: "setup.cloudflare_r2.public",
        fallback:
          "Bucket → Settings → Public access: enable the r2.dev subdomain or connect a custom domain, then paste that address into Public URL.",
      },
      {
        key: "setup.cloudflare_r2.test",
        fallback:
          "Press Test connection, then save. The test uploads a probe object and fetches it back over the public URL, so it fails if the step above was skipped.",
      },
    ],
    caution: {
      key: "setup.cloudflare_r2.caution",
      fallback:
        "Without a Public URL every product image returns 403 in the browser while the credentials still look correct — uploads fall back to the private R2 endpoint, which is never anonymously readable. A custom domain beats r2.dev: Cloudflare's CDN then answers cached requests without billing the bucket.",
    },
  },
  s3: {
    steps: [
      {
        key: "setup.s3.bucket",
        fallback:
          "Create a bucket in the S3 console and note its region — it has to match the region selected above.",
      },
      {
        key: "setup.s3.iam",
        fallback:
          "IAM → create a user with programmatic access and a policy granting these actions on that bucket:",
        code: "s3:PutObject, s3:GetObject, s3:DeleteObject, s3:ListBucket",
      },
      {
        key: "setup.s3.public",
        fallback:
          "Allow public reads with a bucket policy, or put CloudFront in front of the bucket, and paste the resulting address into Public URL.",
      },
      {
        key: "setup.s3.test",
        fallback:
          "Paste the access key pair above, press Test connection, then save.",
      },
    ],
    caution: {
      key: "setup.s3.caution",
      fallback:
        "New buckets have Block all public access switched on. Leave it on only if you serve through CloudFront — otherwise every image on the storefront returns 403.",
    },
  },
  minio: {
    steps: [
      {
        key: "setup.minio.run",
        fallback:
          "Run MinIO next to the app — Coolify and Dokploy both have a one-click template. Mount a volume at /data, or the next redeploy takes every uploaded file with it.",
        code: "volumes:\n  - minio-data:/data",
      },
      {
        key: "setup.minio.keys",
        fallback:
          "Open the MinIO console (port 9001 by default), create a bucket, then Access Keys → Create access key.",
      },
      {
        key: "setup.minio.public",
        fallback: "Let browsers read the bucket:",
        code: "mc anonymous set download myminio/<bucket>",
      },
      {
        key: "setup.minio.fields",
        fallback:
          "Endpoint URL is the API address (port 9000), not the console. Region can stay us-east-1 — MinIO ignores it. Public URL is where browsers reach the bucket.",
      },
      {
        key: "setup.minio.test",
        fallback: "Press Test connection, then save.",
      },
    ],
    caution: {
      key: "setup.minio.caution",
      fallback:
        "Serve MinIO over HTTPS on its own subdomain. Browsers block mixed content, so an http:// endpoint breaks every image on an HTTPS storefront.",
    },
  },
  digitalocean: {
    steps: [
      {
        key: "setup.digitalocean.space",
        fallback:
          "Spaces Object Storage → Create a Space. The datacenter you pick is the endpoint (nyc3, fra1, sgp1…), so choose one near your shoppers and select the same region above.",
      },
      {
        key: "setup.digitalocean.keys",
        fallback:
          "API → Spaces Keys → Generate New Key, and copy both halves into Access Key ID and Secret Access Key.",
      },
      {
        key: "setup.digitalocean.public",
        fallback:
          "Space → Settings → set File Listing to public, or enable the CDN.",
      },
      {
        key: "setup.digitalocean.test",
        fallback:
          "Leave Public URL blank to serve from the Space itself, or paste the CDN endpoint (…cdn.digitaloceanspaces.com) to serve from the edge. Then Test connection and save.",
      },
    ],
    caution: {
      key: "setup.digitalocean.caution",
      fallback:
        "The Space name is the Bucket Name above, and a Space cannot be moved between datacenters afterwards — its region is fixed when you create it.",
    },
  },
};

/**
 * Moving existing media. Ordered the way it has to be run: the credential
 * migration first (the media script reads the per-provider layout), the media
 * sweep second, and the manual check last, because nothing is ever deleted for
 * you.
 */
const MIGRATION_STEPS: GuideStep[] = [
  {
    key: "migration.step1",
    fallback:
      "Configure a provider above and press Test connection — the migration uploads into whatever is saved here.",
  },
  {
    key: "migration.step2",
    fallback:
      "Move the stored credentials to the per-provider layout. Safe on any version, and a no-op once it has run.",
    code: "pnpm db:migrate storage-credentials --dry-run\npnpm db:migrate storage-credentials",
  },
  {
    key: "migration.step3",
    fallback:
      "Upload the local files and rewrite their URLs across the database. The dry run lists every file and writes nothing.",
    code: "pnpm db:migrate media-to-cloud --dry-run\npnpm db:migrate media-to-cloud",
  },
  {
    key: "migration.step4",
    fallback:
      "Check the storefront and the Media Library. Nothing is ever deleted from the disk, so remove the local copies by hand once the images load.",
  },
];

const BACKUP_COMMAND = "cp -r public/uploads private-uploads ~/storify-media-backup/";

export function StorageSetupGuide({
  provider,
  configured,
  legacyLocal,
}: {
  provider: StorageProvider;
  /** Credentials are already on file, so the steps are reference, not work. */
  configured: boolean;
  /** The stored provider is the retired `local`, so the move is overdue. */
  legacyLocal: boolean;
}) {
  const t = useTranslations("admin.settings.storage");
  // Long instructional copy is the first thing to lag behind in a locale, and
  // `t()` on a missing key renders the key path. Fall back to the English the
  // steps are authored in instead.
  const tr = (key: string, fallback: string, values?: Record<string, string>) => {
    if (t.has(key)) return t(key as never, values as never);
    if (!values) return fallback;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      fallback,
    );
  };

  const setup = SETUP[provider];
  const consoleLink = CONSOLE[provider];
  const copyLabel = tr("setup.copy", "Copy");
  const copyFailed = tr("setup.copyFailed", "Unable to copy");

  // Open what is actually unfinished: the steps while the provider has no
  // credentials, the move while the store is still on retired local storage.
  // Evaluated once per provider — retyping a key must not fold the panel shut
  // under the admin's cursor, but switching provider starts the question over.
  const defaultOpen = [
    ...(configured ? [] : ["setup"]),
    ...(legacyLocal ? ["migration"] : []),
  ];

  return (
    <Accordion
      key={provider}
      type="multiple"
      defaultValue={defaultOpen}
      className="rounded-xl border bg-muted/30 px-5"
    >
      <AccordionItem value="setup">
        <AccordionTrigger className="hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="size-4 text-muted-foreground" />
            {tr("setup.title", "{provider} setup guide", {
              provider: STORAGE_PROVIDER_LABELS[provider],
            })}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          <Steps
            steps={setup.steps}
            tr={tr}
            copyLabel={copyLabel}
            copyFailed={copyFailed}
          />
          <Caution>{tr(setup.caution.key, setup.caution.fallback)}</Caution>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild type="button" variant="outline" size="sm">
              <a href={consoleLink.url} target="_blank" rel="noopener noreferrer">
                {tr(consoleLink.key, consoleLink.fallback)}
                <ExternalLink className="ml-2 size-3.5" />
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              {tr("setup.docs", "Full walkthrough: docs/STORAGE_SETUP.md")}
            </p>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="migration">
        <AccordionTrigger className="hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ArrowRightLeft className="size-4 text-muted-foreground" />
            {tr("migration.title", "Move the files you already have")}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {tr(
              "migration.intro",
              "Choosing a provider only changes where new uploads go. Everything uploaded before it stays where it was and keeps loading until you move it across.",
            )}
          </p>
          <Steps
            steps={MIGRATION_STEPS}
            tr={tr}
            copyLabel={copyLabel}
            copyFailed={copyFailed}
          />
          <Caution>
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block">
                {tr(
                  "migration.backup",
                  "Before your next deploy: if your update method replaces the app folder — cPanel upload, zip overwrite, a container with no volume — copy the media off the server first. Replacing the folder deletes it.",
                )}
              </span>
              <Snippet
                code={BACKUP_COMMAND}
                copyLabel={copyLabel}
                copyFailed={copyFailed}
              />
            </span>
          </Caution>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {tr(
              "migration.note",
              "A file that fails to upload keeps its local URL, so a partial run leaves a working store rather than a half-broken one. Re-running is safe.",
            )}
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function Steps({
  steps,
  tr,
  copyLabel,
  copyFailed,
}: {
  steps: GuideStep[];
  tr: (key: string, fallback: string) => string;
  copyLabel: string;
  copyFailed: string;
}) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-3">
          <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium tabular-nums ring-1 ring-border">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <p>{tr(step.key, step.fallback)}</p>
            {step.code ? (
              <Snippet
                code={step.code}
                copyLabel={copyLabel}
                copyFailed={copyFailed}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A command block. Commands are what an admin gets wrong by retyping — a
 * missing `:dry` runs the real migration — so every one of them is copyable.
 */
function Snippet({
  code,
  copyLabel,
  copyFailed,
}: {
  code: string;
  copyLabel: string;
  copyFailed: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(copyFailed);
    }
  };

  return (
    <span className="relative block">
      <span className="block overflow-x-auto rounded-md bg-background py-1.5 pr-9 pl-2.5 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground ring-1 ring-border">
        {code}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copyLabel}
        className="absolute top-1 right-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </span>
  );
}

function Caution({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  );
}
