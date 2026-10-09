import { REQUEST_HEADERS } from "@/contracts/mobile/shop/v1/common";
import { resolveClientIp } from "@/lib/api/client-ip";
import type { AppPlatform } from "@/lib/settings/mobile-app";

/**
 * What the app says about itself in its headers (contracts … common.ts,
 * `REQUEST_HEADERS`), read once per request. Each value is left out when it
 * is missing or malformed; nothing here is trusted for more than routing a
 * rate limit or an update prompt.
 */
export interface ClientInfo {
  appVersion?: string;
  appBuild?: string;
  platform?: AppPlatform;
  /** A UUID the app made on its first launch. */
  installId?: string;
  /** The address the proxy chain vouches for (lib/api/client-ip.ts). */
  ip?: string;
  cartToken?: string;
  idempotencyKey?: string;
  /**
   * `If-Match`, as sent: the version a change was made against (the business
   * app's product edit). The route reads it; nothing else does.
   */
  ifMatch?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_TEXT = /^[\x21-\x7e][\x20-\x7e]{0,63}$/;
const ENTITY_TAGS = /^[\x21-\x7e][\x20-\x7e]{0,255}$/;

function header(headers: Headers, name: string, pattern: RegExp): string | undefined {
  const value = headers.get(name)?.trim();
  return value && pattern.test(value) ? value : undefined;
}

export function readClientInfo(headers: Headers): ClientInfo {
  const platform = headers.get(REQUEST_HEADERS.appPlatform)?.trim().toLowerCase();
  const info: ClientInfo = {
    appVersion: header(headers, REQUEST_HEADERS.appVersion, SHORT_TEXT),
    appBuild: header(headers, REQUEST_HEADERS.appBuild, SHORT_TEXT),
    platform: platform === "ios" || platform === "android" ? platform : undefined,
    installId: header(headers, REQUEST_HEADERS.installId, UUID),
    ip: resolveClientIp(headers) ?? undefined,
    cartToken: header(headers, REQUEST_HEADERS.cartToken, UUID),
    idempotencyKey: header(headers, REQUEST_HEADERS.idempotencyKey, UUID),
    ifMatch: header(headers, "If-Match", ENTITY_TAGS),
  };
  for (const key of Object.keys(info) as (keyof ClientInfo)[]) {
    if (info[key] === undefined) delete info[key];
  }
  return info;
}
