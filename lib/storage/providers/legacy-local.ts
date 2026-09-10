/**
 * Legacy Local Filesystem Provider — read-only
 *
 * Local disk was a storage option until v1.5. It is no longer offered: files
 * written inside the app folder disappear on any deploy that replaces it, and
 * it can never support presigned direct uploads, multiple servers, or a
 * serverless host.
 *
 * This class is what stops that removal from destroying data. A settings
 * document created before v1.5 still says `provider: "local"`, and that store's
 * media is sitting on its disk right now. Everything already there stays
 * readable — product images, vendor KYC documents, and above all the digital
 * deliverables customers have already paid for. Only writing is gone, so the
 * store is pushed toward configuring a real provider instead of quietly
 * accumulating more files in a place that is about to be deleted.
 *
 * There is no way to reach this class from the admin UI. It exists solely for
 * documents that predate the change, and goes away once
 * `pnpm db:migrate media-to-cloud` has moved a store's files.
 *
 * Note that public media does not actually depend on this class — the
 * standalone `/uploads/*` route reads the disk directly. What lives here is the
 * private path, which nothing else can serve.
 */

import { promises as fs, createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import {
  StorageConfig,
  StorageService,
  UploadOptions,
  UploadResult,
  PresignedUrlResult,
  PrivateDownload,
  DeleteResult,
  ListFilesOptions,
  ListFilesResult,
  StorageObject,
} from "../types";

const RETIRED =
  "Local storage was retired in v1.5. Configure Cloudflare R2, AWS S3, MinIO " +
  "or DigitalOcean Spaces in Settings → Storage, then run " +
  "`pnpm db:migrate media-to-cloud` to move the files already on this server. " +
  "See docs/STORAGE_SETUP.md.";

export class LegacyLocalProvider implements StorageService {
  private config: StorageConfig;
  private baseDir: string;
  private privateBaseDir: string;

  constructor(config: StorageConfig) {
    this.config = config;
    this.baseDir = path.join(process.cwd(), "public");
    // Private files (digital product deliverables) live OUTSIDE public/ so
    // they are never statically served.
    this.privateBaseDir = path.join(process.cwd(), "private-uploads");
  }

  /**
   * Resolve a storage key to an absolute path inside a base directory,
   * guarding against traversal. Keys reaching here come from the database, so
   * a crafted one must not be able to read (or delete) outside its own tree —
   * on the private side that would expose other customers' paid downloads.
   */
  private resolve(base: string, key: string): string {
    const fullPath = path.resolve(base, key.replace(/^\/+/, ""));
    const baseResolved = path.resolve(base);
    if (
      fullPath !== baseResolved &&
      !fullPath.startsWith(baseResolved + path.sep)
    ) {
      throw new Error("Invalid storage key: path traversal detected");
    }
    return fullPath;
  }

  /**
   * Always a same-site relative URL, so stored values stay valid on any host
   * and Next treats them as local images. `publicUrl` is an object-store
   * concept and is deliberately ignored.
   */
  getPublicUrl(key: string): string {
    return `/${key.replace(/^\/+/, "")}`;
  }

  /** Local files are served same-site — the public URL is the download URL. */
  async getDownloadUrl(key: string): Promise<string> {
    return this.getPublicUrl(key);
  }

  /**
   * Local disk has no signed URLs, so the bytes are streamed through the
   * authenticated route. This is the digital-product delivery path.
   */
  async getPrivateDownload(key: string): Promise<PrivateDownload> {
    const fullPath = this.resolve(this.privateBaseDir, key);
    const stat = await fs.stat(fullPath);
    const body = Readable.toWeb(
      createReadStream(fullPath),
    ) as ReadableStream<Uint8Array>;
    return { kind: "stream", body, size: stat.size };
  }

  /**
   * List what is still on the disk, newest first — the admin Media Library
   * needs it to show a legacy store what it has left to migrate. The cursor is
   * a plain offset into the sorted listing; re-walking per page is fine at
   * admin-UI scale.
   */
  async listFiles(options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(parseInt(options.cursor ?? "0", 10) || 0, 0);

    const prefix = (this.config.pathPrefix || "uploads/").replace(/^\/+/, "");
    const root = this.resolve(this.baseDir, prefix);

    const entries: { key: string; size: number; mtimeMs: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
        throw error;
      }
      for (const dirent of dirents) {
        const fullPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          await walk(fullPath);
        } else if (dirent.isFile() && !dirent.name.startsWith(".")) {
          const stat = await fs.stat(fullPath);
          entries.push({
            key: path.relative(this.baseDir, fullPath).split(path.sep).join("/"),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        }
      }
    };
    await walk(root);

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const files: StorageObject[] = entries
      .slice(offset, offset + limit)
      .map((entry) => ({
        key: entry.key,
        url: this.getPublicUrl(entry.key),
        size: entry.size,
        lastModified: new Date(entry.mtimeMs).toISOString(),
      }));

    return {
      success: true,
      files,
      nextCursor:
        offset + limit < entries.length ? String(offset + limit) : undefined,
    };
  }

  /**
   * Deleting stays real. Removing a product should not leave its image behind
   * on the disk, and the operation is idempotent — a file that is already gone
   * counts as deleted.
   */
  async deleteFile(key: string): Promise<DeleteResult> {
    return this.unlink(this.baseDir, key);
  }

  async deletePrivateFile(key: string): Promise<DeleteResult> {
    return this.unlink(this.privateBaseDir, key);
  }

  private async unlink(base: string, key: string): Promise<DeleteResult> {
    try {
      await fs.unlink(this.resolve(base, key));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    return { success: true, key };
  }

  /**
   * Reports the store as unconfigured, which is exactly what it is: the admin
   * sees a red status chip and the reason, rather than a green one on a
   * provider that cannot accept a single new file.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: RETIRED };
  }

  // Writing is what was actually removed. The signatures still match
  // StorageService so nothing has to special-case this provider — callers get
  // an error that names the fix instead of a file in a folder about to be
  // deleted.
  async uploadFile(_file: Buffer, _options: UploadOptions): Promise<UploadResult> {
    throw new Error(RETIRED);
  }

  async uploadPrivateFile(
    _file: Buffer,
    _options: UploadOptions,
  ): Promise<UploadResult> {
    throw new Error(RETIRED);
  }

  async getPresignedUploadUrl(
    _options: UploadOptions,
  ): Promise<PresignedUrlResult> {
    throw new Error(RETIRED);
  }
}
