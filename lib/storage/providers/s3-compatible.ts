/**
 * S3-Compatible Storage Provider
 *
 * Backs all four selectable providers — Cloudflare R2, AWS S3, MinIO and
 * DigitalOcean Spaces. They differ only in how the endpoint and region are
 * resolved in the constructor; every operation below is identical.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  StorageConfig,
  StorageService,
  UploadOptions,
  UploadResult,
  PresignedUrlResult,
  PrivateDownload,
  PrivateDownloadOptions,
  DeleteResult,
  ListFilesOptions,
  ListFilesResult,
  StorageObject,
} from "../types";
import { generateStorageKey, ownerPrefix } from "../key";
import { isVectorImageType } from "../content-type";
import {
  awsRegion,
  clientRegion,
  resolveStorageEndpoint,
} from "../endpoint";

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes

/**
 * The client for a configuration — the provider's, and the private-storage
 * migration's, which moves objects between the two buckets directly.
 */
export function createS3Client(config: StorageConfig): S3Client {
  const endpoint = resolveStorageEndpoint(config);
  return new S3Client({
    endpoint,
    // R2 always requires "auto" — ignore any stored region there; Spaces wants
    // its datacenter slug; the rest want a real AWS-style region.
    region: clientRegion(config),
    credentials: {
      accessKeyId: config.accessKeyId as string,
      secretAccessKey: config.secretAccessKey as string,
    },
    // Path-style addressing for R2 and for any custom endpoint
    // (MinIO/Spaces/…): virtual-hosted requests to `bucket.<endpoint-host>`
    // usually fail there, and getPublicUrl builds path-style URLs for
    // custom endpoints — keep the two consistent.
    forcePathStyle: config.provider === "cloudflare_r2" || Boolean(endpoint),
  });
}

export class S3CompatibleProvider implements StorageService {
  private client: S3Client;
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    // Copy before deriving the endpoint below: getStorageConfig() hands out
    // the same cached object to every caller for a minute, so writing to it
    // here left an R2 endpoint on the config that a later "s3" provider then
    // read as its own.
    this.config = { ...config };

    // Validate required fields
    if (!config.bucketName) {
      throw new Error("Bucket name is required for S3-compatible storage");
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error(
        "Access credentials are required for S3-compatible storage",
      );
    }

    // The one field each backend cannot derive for itself. Checked before
    // resolving so the admin gets the missing field's name rather than a
    // client pointed at nothing.
    if (config.provider === "cloudflare_r2" && !config.accountId) {
      throw new Error("Account ID is required for Cloudflare R2");
    }
    if (config.provider === "minio" && !config.endpoint) {
      throw new Error("Endpoint URL is required for MinIO");
    }

    // Shared with getStorageConfig — see lib/storage/endpoint.ts for why the
    // derivation cannot live in this constructor alone.
    this.config.endpoint = resolveStorageEndpoint(config);
    this.client = createS3Client(config);
  }

  /**
   * Generate storage key from options
   */
  private generateKey(options: UploadOptions): string {
    return generateStorageKey(this.config.pathPrefix, options);
  }

  /**
   * Get public URL for a key
   */
  getPublicUrl(key: string): string {
    if (this.config.publicUrl) {
      // Use configured CDN/public URL
      const baseUrl = this.config.publicUrl.replace(/\/$/, "");
      return `${baseUrl}/${key}`;
    }

    // Construct URL from endpoint
    if (this.config.endpoint) {
      const baseUrl = this.config.endpoint.replace(/\/$/, "");
      return `${baseUrl}/${this.config.bucketName}/${key}`;
    }

    // Default S3 URL format
    return `https://${this.config.bucketName}.s3.${awsRegion(this.config.region)}.amazonaws.com/${key}`;
  }

  /**
   * Generate presigned upload URL
   */
  async getPresignedUploadUrl(
    options: UploadOptions,
  ): Promise<PresignedUrlResult> {
    const key = this.generateKey(options);

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.fileSize,
      Metadata: options.metadata,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN,
      // The presigner leaves Content-Type out of the signature by default, and
      // the bucket stores whatever type the PUT sends — so a URL issued for a
      // photo could store a page as text/html or image/svg+xml, served from the
      // store's media host. Signed, the PUT must send the type validated when
      // the URL was issued. (Content-Length is signed already.)
      signableHeaders: new Set(["content-type"]),
    });

    return {
      success: true,
      uploadUrl,
      publicUrl: this.getPublicUrl(key),
      key,
      expiresIn: PRESIGNED_URL_EXPIRES_IN,
    };
  }

  /**
   * Upload file directly (server-side)
   */
  async uploadFile(
    file: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    const key = this.generateKey(options);

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: file,
      ContentType: options.contentType,
      ContentLength: options.fileSize,
      // A vector kept raw (the logo's exception) still renders in an <img>,
      // but opened on its own it downloads instead of running as a page.
      ContentDisposition: isVectorImageType(options.contentType)
        ? "attachment"
        : undefined,
      Metadata: options.metadata,
    });

    await this.client.send(command);

    return {
      success: true,
      key,
      url: this.getPublicUrl(key),
      size: options.fileSize,
      contentType: options.contentType,
    };
  }

  /**
   * Delete a file
   */
  async deleteFile(key: string): Promise<DeleteResult> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });

    await this.client.send(command);

    return {
      success: true,
      key,
    };
  }

  /**
   * List stored files under the path prefix (or one owner's folder of it) via
   * ListObjectsV2. The cursor is the S3 continuation token. Order is the
   * bucket's lexicographic key order (date-partitioned keys ⇒ roughly
   * chronological).
   */
  async listFiles(options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix:
        ownerPrefix(this.config.pathPrefix, options.ownerScope) || undefined,
      MaxKeys: limit,
      ContinuationToken: options.cursor || undefined,
    });

    const response = await this.client.send(command);

    const files: StorageObject[] = (response.Contents ?? [])
      .filter((object) => object.Key && !object.Key.endsWith("/"))
      .map((object) => ({
        key: object.Key as string,
        url: this.getPublicUrl(object.Key as string),
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString(),
      }));

    return {
      success: true,
      files,
      nextCursor: response.IsTruncated
        ? response.NextContinuationToken
        : undefined,
    };
  }

  /**
   * Loadable URL for a key. With a public URL configured that's the public
   * URL; otherwise a short-lived presigned GET, so the admin Media Library
   * can preview bucket contents even before public access is set up.
   */
  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.config.publicUrl) return this.getPublicUrl(key);

    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * The bucket private files are written to: the private bucket when one is
   * configured, else the public one they used to share.
   */
  private get privateBucket(): string {
    return this.config.privateBucketName || (this.config.bucketName as string);
  }

  private get hasSeparatePrivateBucket(): boolean {
    return this.privateBucket !== this.config.bucketName;
  }

  /**
   * The bucket holding a private key. A file uploaded before the private
   * bucket was configured stays in the public one until
   * `db:migrate private-storage` moves it, so a key the private bucket does
   * not have is served from where it was written.
   */
  private async bucketHoldingPrivateKey(key: string): Promise<string> {
    if (!this.hasSeparatePrivateBucket) return this.privateBucket;
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
      return this.privateBucket;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return this.config.bucketName as string;
      throw error;
    }
  }

  /**
   * Store a private file. Uses the caller's key as-is (no public pathPrefix)
   * and never reports a URL — delivery goes through getPrivateDownload's
   * always-signed GET, regardless of any configured public URL.
   */
  async uploadPrivateFile(
    file: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    const key = generateStorageKey(undefined, options);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        Body: file,
        ContentType: options.contentType,
        ContentLength: options.fileSize,
        Metadata: options.metadata,
      }),
    );

    return {
      success: true,
      key,
      url: "",
      size: options.fileSize,
      contentType: options.contentType,
    };
  }

  /**
   * Always-signed GET for private files — unlike getDownloadUrl this never
   * falls back to the public URL. The disposition is an attachment, so the
   * browser downloads with the original filename, unless the caller asks for
   * "inline".
   */
  async getPrivateDownload(
    key: string,
    options: PrivateDownloadOptions = {},
  ): Promise<PrivateDownload> {
    const disposition = options.disposition ?? "attachment";
    const command = new GetObjectCommand({
      Bucket: await this.bucketHoldingPrivateKey(key),
      Key: key,
      ResponseContentDisposition: options.filename
        ? `${disposition}; filename="${options.filename.replace(/["\\\r\n]/g, "_")}"`
        : disposition,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? 300,
    });
    return { kind: "redirect", url };
  }

  /**
   * Delete a private file — from the public bucket too while one may still
   * hold a copy written before the private bucket existed. Deleting a key a
   * bucket does not have succeeds on S3, so this needs no lookup.
   */
  async deletePrivateFile(key: string): Promise<DeleteResult> {
    if (this.hasSeparatePrivateBucket) {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
    }
    return this.deleteFile(key);
  }

  /**
   * Test storage connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.config.bucketName,
      });

      await this.client.send(command);

      const providerName =
        this.config.provider === "cloudflare_r2" ? "Cloudflare R2" : "AWS S3";

      if (this.hasSeparatePrivateBucket) {
        try {
          await this.client.send(
            new HeadBucketCommand({ Bucket: this.privateBucket }),
          );
        } catch (error) {
          return {
            success: false,
            message: `${providerName} connected, but the private bucket "${this.privateBucket}" could not be reached: ${
              error instanceof Error && error.message ? error.message : "no answer"
            }. Check its name, and that these keys may use it.`,
          };
        }
        return {
          success: true,
          message: `${providerName} connected successfully, with the private bucket "${this.privateBucket}"`,
        };
      }

      return {
        success: true,
        message: `${providerName} connected successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Failed to connect to storage",
      };
    }
  }
}
