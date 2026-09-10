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
import { generateStorageKey } from "../key";
import {
  awsRegion,
  clientRegion,
  resolveStorageEndpoint,
} from "../endpoint";

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes

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
    const endpoint = resolveStorageEndpoint(config);
    this.config.endpoint = endpoint;

    // R2 always requires "auto" — ignore any stored region there; Spaces wants
    // its datacenter slug; the rest want a real AWS-style region.
    const region = clientRegion(config);
    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Path-style addressing for R2 and for any custom endpoint
      // (MinIO/Spaces/…): virtual-hosted requests to `bucket.<endpoint-host>`
      // usually fail there, and getPublicUrl builds path-style URLs for
      // custom endpoints — keep the two consistent.
      forcePathStyle: config.provider === "cloudflare_r2" || Boolean(endpoint),
    });
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
   * List stored files under the path prefix via ListObjectsV2. The cursor is
   * the S3 continuation token. Order is the bucket's lexicographic key order
   * (date-partitioned keys ⇒ roughly chronological).
   */
  async listFiles(options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: this.config.pathPrefix || undefined,
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
        Bucket: this.config.bucketName,
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
   * falls back to the public URL, and it forces an attachment disposition so
   * the browser downloads with the original filename.
   */
  async getPrivateDownload(
    key: string,
    options: PrivateDownloadOptions = {},
  ): Promise<PrivateDownload> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ResponseContentDisposition: options.filename
        ? `attachment; filename="${options.filename.replace(/["\\\r\n]/g, "_")}"`
        : "attachment",
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? 300,
    });
    return { kind: "redirect", url };
  }

  /**
   * Delete a private file — same operation as deleteFile on S3.
   */
  async deletePrivateFile(key: string): Promise<DeleteResult> {
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
