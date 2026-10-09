"use client";

import type { Settings } from "@/components/admin/settings/types";
import type { CredentialFieldMeta } from "@/lib/settings/credential-fields";

const EMPTY: CredentialFieldMeta = { set: false };

/**
 * Look up the masked preview + presence flag the server published for a
 * credential field, by its settings dot-path (e.g. "payment.stripe.secretKey").
 * Returns a not-set placeholder when the payload predates the field, so callers
 * never have to null-check.
 */
export function credentialMeta(
  settings: Settings | null | undefined,
  path: string,
): CredentialFieldMeta {
  return settings?._meta?.credentials?.[path] ?? EMPTY;
}

/**
 * Bind `credentialMeta` to one settings object, for components that read many
 * credential fields.
 */
export function useCredentialMeta(settings: Settings | null | undefined) {
  return (path: string) => credentialMeta(settings, path);
}
