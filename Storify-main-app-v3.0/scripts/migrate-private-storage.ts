import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getStorageConfig } from "@/lib/storage";
import { createS3Client } from "@/lib/storage/providers/s3-compatible";
import { PRIVATE_STORAGE_PREFIXES } from "@/lib/storage/private-prefixes";
import { movePrivateObjects } from "@/lib/storage/move-private-objects";

/**
 * Private storage migration
 * =========================
 *
 * Vendor identity documents, digital products and expense receipts used to
 * share the store's public bucket, told apart only by their key prefix. On a
 * bucket served publicly — R2 public access or a custom domain, a CDN, MinIO
 * anonymous download — anyone holding a file's key can read it, and a key
 * leaks: through an expired signed link, a log, a screenshot.
 *
 * 2.4 writes them to a private bucket (Admin → Settings → Storage → Private
 * bucket, or STORAGE_PRIVATE_BUCKET). This moves the ones already stored: each
 * object under a private prefix is copied to the private bucket under the
 * same key, checked there, and deleted from the public one
 * (`lib/storage/move-private-objects.ts`). The database holds keys, so nothing
 * else changes, and until a file has moved it is still served from where it
 * is.
 *
 * The same key, not a new one: in a bucket with no public access a key opens
 * nothing without a signed link, so a leaked key stops mattering once the file
 * has left the public bucket.
 *
 * Idempotent — a moved file is gone from the public bucket, so a rerun finds
 * only what is left. It moves files, so it is not part of `--all`.
 *
 * Usage:
 *   pnpm db:migrate private-storage --dry-run   (list what would move)
 *   pnpm db:migrate private-storage             (move it)
 */

const DRY_RUN = process.argv.includes("--dry-run");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function run() {
  console.log(
    `\nPrivate storage migration${DRY_RUN ? " (dry run — nothing moves)" : ""}\n`,
  );

  const config = await getStorageConfig();
  if (config.provider === "local") {
    console.log(
      "This store keeps its files on the server's disk, where private files are already outside public/. Nothing to move.",
    );
    return;
  }
  const publicBucket = config.bucketName;
  const privateBucket = config.privateBucketName;
  if (!publicBucket) throw new Error("No storage bucket is configured.");
  if (!privateBucket || privateBucket === publicBucket) {
    throw new Error(
      "Set a private bucket first — Admin → Settings → Storage → Private bucket, or STORAGE_PRIVATE_BUCKET — then run this again.",
    );
  }
  const pathPrefix = config.pathPrefix || "";
  const overlap = PRIVATE_STORAGE_PREFIXES.find(
    (prefix) => pathPrefix.startsWith(prefix) || prefix.startsWith(pathPrefix),
  );
  if (overlap) {
    throw new Error(
      `The storage path prefix "${pathPrefix}" overlaps the private prefix "${overlap}", so public media cannot be told apart from private files. Change the path prefix first.`,
    );
  }

  const client = createS3Client(config);
  await client.send(new HeadBucketCommand({ Bucket: privateBucket }));
  console.log(`From "${publicBucket}" to "${privateBucket}" (${config.provider})\n`);

  const report = await movePrivateObjects(client, {
    publicBucket,
    privateBucket,
    prefixes: PRIVATE_STORAGE_PREFIXES,
    dryRun: DRY_RUN,
    onObject: DRY_RUN
      ? (object) => console.log(`  ${object.key}  (${formatBytes(object.size)})`)
      : undefined,
  });

  for (const { prefix, count, bytes } of report.prefixes) {
    console.log(`${prefix}  ${count} file(s), ${formatBytes(bytes)}`);
  }
  console.log(
    `\n${DRY_RUN ? "Would move" : "Moved"} ${report.moved} file(s), ${formatBytes(report.movedBytes)}.`,
  );
  if (report.failures.length > 0) {
    console.error(
      `\n${report.failures.length} file(s) could not be moved and stay where they are:`,
    );
    for (const failure of report.failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
  if (!DRY_RUN && report.moved > 0) {
    console.log(
      "\nIf a CDN serves your public bucket, purge its cache now: an edge that kept a copy of one of these files serves it until it expires.",
    );
  }
}

run()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
