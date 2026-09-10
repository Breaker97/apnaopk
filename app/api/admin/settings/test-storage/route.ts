// The draft posts each provider's credential block under its own key.
const TestStorageSchema = z.record(z.string(), z.unknown());

/**
 * POST /api/admin/settings/test-storage
 * Test storage connection with provided configuration
 */

import { NextResponse } from "next/server";
import {
  testStorageConnection,
  StorageConfig,
  SELECTABLE_STORAGE_PROVIDERS,
  isSelectableStorageProvider,
} from "@/lib/storage";
import { getSettings } from "@/models/settings.model";
import {
  resolveStorageCredentials,
  STORAGE_CREDENTIAL_BLOCKS,
} from "@/lib/settings/credentials";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";

export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    // Every test reaches an outside service (or sends real mail), so it is
    // throttled like test-carrier rather than left to the admin's patience.
    rateLimit: { action: "admin:settings:test-storage", preset: "strict" },
  },
  async ({ request }) => {
    try {
      // Require admin authentication
      const body = TestStorageSchema.parse(await request.json());

      // Only a provider that can actually be configured may be tested. A
      // pre-v1.5 draft still says "local" until the admin saves, and testing
      // that reports the retirement notice instead of the R2 credentials the
      // form is showing; anything else unrecognized used to be treated as AWS.
      const provider = body.provider;
      if (!isSelectableStorageProvider(provider)) {
        return NextResponse.json(
          {
            success: false,
            message: `Select a storage provider first (one of: ${SELECTABLE_STORAGE_PROVIDERS.join(", ")})`,
          },
          { status: 400 },
        );
      }

      // Credentials are stripped from the settings payload (only masked hints
      // reach the browser), so the form submits them blank unless the admin
      // typed a new value. Fall back to what is stored — DB first, then env —
      // so "Test connection" checks the configuration that is actually in use.
      const settings = await getSettings();
      const saved = resolveStorageCredentials(settings.storage, provider);

      // The draft posts each provider's fields inside its own block. Test the
      // one being configured, never a stale sibling.
      const posted = body[STORAGE_CREDENTIAL_BLOCKS[provider] ?? "r2"];
      const typed: Record<string, unknown> =
        posted && typeof posted === "object" && !Array.isArray(posted)
          ? (posted as Record<string, unknown>)
          : {};

      const typedOrSaved = (value: unknown, fallback?: string) => {
        const typedValue = typeof value === "string" ? value.trim() : "";
        return typedValue || fallback;
      };
      const accountId = typedOrSaved(typed.accountId, saved.accountId);
      const endpoint = typedOrSaved(typed.endpoint, saved.endpoint);
      const region = typedOrSaved(typed.region, saved.region);
      const bucketName = typedOrSaved(typed.bucketName, saved.bucketName);
      const publicUrl = typedOrSaved(typed.publicUrl, saved.publicUrl);
      const accessKeyId = typedOrSaved(typed.accessKeyId, saved.accessKeyId);
      const secretAccessKey = typedOrSaved(
        typed.secretAccessKey,
        saved.secretAccessKey,
      );

      // Validate required fields. Every provider is S3-compatible, so the bucket
      // and key pair are always required; the extra field differs per backend.
      if (!bucketName || !accessKeyId || !secretAccessKey) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Bucket name, access key ID, and secret access key are required",
          },
          { status: 400 },
        );
      }

      if (provider === "cloudflare_r2" && !accountId) {
        return NextResponse.json(
          { success: false, message: "Account ID is required for Cloudflare R2" },
          { status: 400 },
        );
      }

      if (provider === "minio" && !endpoint) {
        return NextResponse.json(
          { success: false, message: "Endpoint URL is required for MinIO" },
          { status: 400 },
        );
      }

      // Build config object
      const config: StorageConfig = {
        provider,
        accountId,
        endpoint,
        region: region || "auto",
        bucketName,
        accessKeyId,
        secretAccessKey,
        publicUrl,
        maxFileSizeMB: 10,
        allowedMimeTypes: [],
      };

      // Test connection + public URL accessibility
      const result = await testStorageConnection(config, true);

      return NextResponse.json({
        success: result.success,
        message: result.message,
      });
    } catch (error) {
      console.error("Storage test error:", error);
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Failed to test storage connection",
        },
        { status: 500 },
      );
    }
  },
);
