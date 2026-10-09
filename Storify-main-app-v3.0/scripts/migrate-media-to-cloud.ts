/**
 * Move media off this server's disk and into the configured storage provider.
 *
 * Local storage was retired in v1.5. Files already written to `public/uploads/`
 * and `private-uploads/` keep being served — the /uploads/* route reads them
 * straight off the disk — but they are stranded there: nothing new can join
 * them, and the next deploy that replaces the app folder takes them with it.
 * This is the way out.
 *
 * What it does
 * ------------
 * 1. Uploads every file under `public/<pathPrefix>` to the configured provider
 *    under the SAME object key, so nothing about the layout changes except
 *    where the bytes live.
 * 2. Uploads every file under `private-uploads/` the same way. Digital-product
 *    deliverables are referenced by key, not URL, so those references keep
 *    working untouched.
 * 3. Rewrites the public URLs across the database: every `/<pathPrefix>…`
 *    string becomes the provider's absolute URL for that same key.
 *
 * Why the database sweep is generic rather than a list of fields: media URLs
 * are spread over ~23 models, some nested inside arrays (product variants,
 * blog content, chat attachments), and a hand-written field list is exactly
 * the kind of thing that silently misses one and leaves a broken image behind.
 * Every collection is walked instead, and only strings that resolve to a file
 * this run actually uploaded are touched.
 *
 * Safety
 * ------
 * - `--dry-run` reports the whole plan and writes nothing.
 * - A file that fails to upload is never added to the rewrite map, so its
 *   URL keeps pointing at the local copy that still works.
 * - Local files are NEVER deleted. Verify the store, then remove them by hand.
 * - Re-running is a no-op: the second pass finds no `/<pathPrefix>` URLs left.
 *
 * Known limit: migrated objects keep their original keys, so historical media
 * is not filed under `vendor/<id>/…` the way new uploads are. Attributing an
 * existing file to a vendor means guessing from whichever document happens to
 * reference it, and a wrong guess is a broken image — not worth it.
 *
 * Usage:
 *   pnpm db:migrate media-to-cloud --dry-run
 *   pnpm db:migrate media-to-cloud
 */

import { promises as fs } from "fs";
import path from "path";
import mongoose from "mongoose";
import type { AnyBulkWriteOperation } from "mongodb";

import { connectDB, disconnectDB } from "@/lib/db";
import { getStorageConfig, getStorageService } from "@/lib/storage";

const DRY_RUN = process.argv.includes("--dry-run");

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  pdf: "application/pdf",
  zip: "application/zip",
};

function contentTypeOf(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

/** Every file under `dir`, as paths relative to it. */
async function walk(dir: string, base = dir): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // Directory absent — nothing was ever stored locally.
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      found.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return found;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Replace every mapped local URL inside a value, however deeply nested.
 * Returns the rewritten value and how many replacements happened.
 */
function rewriteValue(
  value: unknown,
  urlPattern: RegExp,
  urlMap: Map<string, string>,
  counter: { count: number },
): unknown {
  if (typeof value === "string") {
    if (!value.includes("/")) return value;
    return value.replace(urlPattern, (match) => {
      const replacement = urlMap.get(match);
      if (!replacement) return match;
      counter.count++;
      return replacement;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteValue(item, urlPattern, urlMap, counter));
  }

  // Only plain objects: never walk into ObjectId, Date, Binary…
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewriteValue(item, urlPattern, urlMap, counter);
    }
    return out;
  }

  return value;
}

async function run() {
  console.log(
    `\nMedia migration — local disk → cloud${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await connectDB();
  const { host, name } = mongoose.connection;
  console.log(`✓ Connected to MongoDB — ${host}/${name}`);

  const config = await getStorageConfig();
  if (config.provider === "local") {
    console.error(
      "\n❌ Storage is still set to the retired local provider.\n" +
        "   Configure R2, S3, MinIO or DigitalOcean Spaces in Settings → Storage first —\n" +
        "   this script needs somewhere to move the files to.",
    );
    throw new Error("No cloud provider configured");
  }
  console.log(`✓ Target provider: ${config.provider}\n`);

  const prefix = config.pathPrefix || "uploads/";
  const publicDir = path.join(process.cwd(), "public", prefix);
  const privateDir = path.join(process.cwd(), "private-uploads");

  const [publicFiles, privateFiles] = await Promise.all([
    walk(publicDir),
    walk(privateDir),
  ]);

  if (publicFiles.length === 0 && privateFiles.length === 0) {
    console.log("Nothing to do — no local media found.");
    return;
  }

  console.log(
    `Found ${publicFiles.length} public file(s) under public/${prefix}` +
      ` and ${privateFiles.length} private file(s) under private-uploads/\n`,
  );

  const storage = await getStorageService();

  /** Local public URL → provider URL, for files that uploaded successfully. */
  const urlMap = new Map<string, string>();
  let uploaded = 0;
  let uploadedBytes = 0;
  const failures: string[] = [];

  for (const relative of publicFiles) {
    const key = `${prefix}${relative}`;
    const localUrl = `/${key}`;
    const absolute = path.join(publicDir, relative);

    try {
      const stat = await fs.stat(absolute);
      if (DRY_RUN) {
        console.log(`  ${localUrl}  (${formatBytes(stat.size)})`);
        uploaded++;
        uploadedBytes += stat.size;
        continue;
      }

      const buffer = await fs.readFile(absolute);
      // customPath without a trailing slash is the "use this as the whole key"
      // branch; the provider re-adds pathPrefix, so hand it the remainder.
      const result = await storage.uploadFile(buffer, {
        fileName: path.basename(relative),
        contentType: contentTypeOf(relative),
        fileSize: buffer.length,
        customPath: relative,
      });

      urlMap.set(localUrl, result.url);
      uploaded++;
      uploadedBytes += buffer.length;
      if (uploaded % 25 === 0) {
        console.log(`  …${uploaded}/${publicFiles.length} public files`);
      }
    } catch (error) {
      failures.push(
        `${localUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let privateUploaded = 0;
  for (const relative of privateFiles) {
    const absolute = path.join(privateDir, relative);
    try {
      const stat = await fs.stat(absolute);
      if (DRY_RUN) {
        console.log(`  [private] ${relative}  (${formatBytes(stat.size)})`);
        privateUploaded++;
        uploadedBytes += stat.size;
        continue;
      }

      const buffer = await fs.readFile(absolute);
      // Private uploads take no path prefix, so the key is preserved exactly —
      // which is what keeps existing digital-product references valid.
      await storage.uploadPrivateFile(buffer, {
        fileName: path.basename(relative),
        contentType: contentTypeOf(relative),
        fileSize: buffer.length,
        customPath: relative,
      });
      privateUploaded++;
      uploadedBytes += buffer.length;
    } catch (error) {
      failures.push(
        `[private] ${relative}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `\n✓ ${DRY_RUN ? "Would upload" : "Uploaded"} ${uploaded} public + ` +
      `${privateUploaded} private file(s), ${formatBytes(uploadedBytes)}`,
  );

  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} file(s) failed to upload:`);
    for (const failure of failures.slice(0, 20)) console.log(`   ${failure}`);
    if (failures.length > 20) {
      console.log(`   …and ${failures.length - 20} more`);
    }
    console.log(
      "   Their URLs are left pointing at the local copies, which still work.",
    );
  }

  if (DRY_RUN) {
    console.log(
      "\nDry run complete. Re-run without --dry-run to upload and rewrite URLs.",
    );
    return;
  }

  if (urlMap.size === 0) {
    console.log("\nNo public files uploaded — skipping the URL rewrite.");
    return;
  }

  // Rewrite the database. Anchored to the configured prefix so the pattern
  // cannot match an unrelated string, and every match is checked against the
  // map — a URL whose file did not upload is left exactly as it was.
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const urlPattern = new RegExp(`/${escapedPrefix}[A-Za-z0-9._\\-/]+`, "g");

  console.log("\nRewriting stored URLs…");
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection has no database handle");

  const collections = await db.listCollections().toArray();

  let documentsChanged = 0;
  let urlsRewritten = 0;

  for (const { name: collectionName } of collections) {
    const collection = db.collection(collectionName);
    const cursor = collection.find({});
    let operations: AnyBulkWriteOperation[] = [];
    let changedHere = 0;

    for await (const doc of cursor) {
      const counter = { count: 0 };
      const { _id, ...rest } = doc;
      const rewritten = rewriteValue(
        rest,
        urlPattern,
        urlMap,
        counter,
      ) as Record<string, unknown>;
      if (counter.count === 0) continue;

      operations.push({
        updateOne: { filter: { _id }, update: { $set: rewritten } },
      });
      changedHere++;
      urlsRewritten += counter.count;

      if (operations.length >= 200) {
        await collection.bulkWrite(operations);
        operations = [];
      }
    }

    if (operations.length > 0) await collection.bulkWrite(operations);
    if (changedHere > 0) {
      documentsChanged += changedHere;
      console.log(`  ${collectionName}: ${changedHere} document(s)`);
    }
  }

  console.log(
    `\n✅ Rewrote ${urlsRewritten} URL(s) across ${documentsChanged} document(s).`,
  );
  console.log(
    "\nNext: open the storefront and the admin Media Library and confirm images load.\n" +
      `Once you are satisfied, the local copies under public/${prefix} and private-uploads/\n` +
      "can be deleted — this script never removes them.",
  );
}

run()
  .then(async () => {
    await disconnectDB();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\n❌ Media migration failed:", error);
    await disconnectDB().catch(() => null);
    process.exit(1);
  });
