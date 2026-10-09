import "server-only";

import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import type { StorageConfig, StorageService } from "@/lib/storage";
import { mimeEssence } from "@/lib/storage/content-type";
import { uploadMediaFile, type UploadedMediaRecord } from "./upload-file";

/**
 * Bringing a picture another site hosts into the store's own media storage —
 * the logos and banners of an imported vendor, whose old site will close.
 *
 * The URL comes from a file someone uploaded, so the server fetching it is
 * the classic SSRF shape. Every address a host name resolves to must be a
 * public one (checked at connect time, so a DNS answer cannot change between
 * the check and the connection), only https is followed, each redirect is
 * judged the same way, and the body stops at a size cap and a deadline.
 */

const MB = 1024 * 1024;
/** Above any store's image limit, whatever its storage settings say. */
const ABSOLUTE_MAX_IMAGE_BYTES = 20 * MB;
const DEFAULT_MAX_IMAGE_MB = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = `Storify-Import/1.0 (${
  process.env.NEXT_PUBLIC_APP_URL || "https://storify.app"
})`;

export type RemoteImageFailure =
  | "invalid_url"
  | "not_https"
  | "private_address"
  | "unreachable"
  | "too_many_redirects"
  | "http_error"
  | "timeout"
  | "not_image"
  | "too_large"
  | "unreadable";

/** A refusal worded for a row error: "Logo URL " + message. */
export class RemoteImageError extends Error {
  constructor(
    readonly failure: RemoteImageFailure,
    message: string,
  ) {
    super(message);
    this.name = "RemoteImageError";
  }
}

// --- Which addresses may be fetched ----------------------------------------

function isPublicIPv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false; // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, the cloud metadata service
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function embeddedIPv4(address: string): string | null {
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  const v4 = embeddedIPv4(lower);
  if (v4) return isPublicIPv4(v4);
  if (lower === "::" || lower === "::1") return false;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (lower.startsWith("64:ff9b:")) return false; // NAT64 reaches IPv4 space
  if (lower.startsWith("2001:db8:")) return false; // documentation
  if (lower.startsWith("100::")) return false; // discard-only
  return true;
}

/** Whether an address is on the public internet: no private, loopback or metadata range. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

const privateAddressError = () =>
  new RemoteImageError("private_address", "points to a private network address");

/**
 * A `lookup` for `https.get` that refuses a host when any of its addresses is
 * not public. Node calls it when it connects, so the address checked is the
 * address used.
 */
export function createSafeLookup(resolver: Resolver = dns.lookup as unknown as Resolver) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: LookupCallback,
  ) => {
    resolver(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
        callback(privateAddressError() as NodeJS.ErrnoException, "", 0);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// --- Fetching ----------------------------------------------------------------

export interface RemoteImageResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Buffer>;
  destroy(): void;
}

/** One GET, no redirects followed. Replaced in tests. */
export type RemoteImageTransport = (url: URL, signal: AbortSignal) => Promise<RemoteImageResponse>;

const safeLookup = createSafeLookup();

const httpsTransport: RemoteImageTransport = (url, signal) =>
  new Promise((resolve, reject) => {
    // An address written into the URL is connected to without a lookup.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && !isPublicAddress(literal)) {
      reject(privateAddressError());
      return;
    }
    const request = https.get(
      url,
      {
        lookup: safeLookup as unknown as net.LookupFunction,
        signal,
        headers: { accept: "image/*", "user-agent": USER_AGENT },
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          destroy: () => response.destroy(),
        }),
    );
    request.on("error", reject);
  });

function header(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseHttpsUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new RemoteImageError("invalid_url", "is not a valid link");
  }
  if (url.protocol !== "https:") {
    throw new RemoteImageError("not_https", "must start with https://");
  }
  if (url.username || url.password) {
    throw new RemoteImageError("invalid_url", "must not carry a user name or password");
  }
  return url;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
};

/** A file name for the stored copy: the link's own, else `image.<ext>`. */
function fileNameFor(url: URL, contentType: string): string {
  const last = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const cleaned = last.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const extension = EXTENSION_BY_TYPE[contentType] ?? "img";
  if (!cleaned) return `image.${extension}`;
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${extension}`;
}

export interface FetchedRemoteImage {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

export async function fetchRemoteImage(
  rawUrl: string,
  options: {
    maxBytes: number;
    timeoutMs?: number;
    maxRedirects?: number;
    transport?: RemoteImageTransport;
  },
): Promise<FetchedRemoteImage> {
  const transport = options.transport ?? httpsTransport;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = () =>
    new RemoteImageError("timeout", `did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
  const tooLarge = () =>
    new RemoteImageError("too_large", `is larger than ${Math.floor(options.maxBytes / MB)} MB`);

  let url = parseHttpsUrl(rawUrl.trim());
  for (let hop = 0; ; hop++) {
    let response: RemoteImageResponse;
    try {
      response = await transport(url, signal);
    } catch (error) {
      if (error instanceof RemoteImageError) throw error;
      if (signal.aborted) throw timedOut();
      throw new RemoteImageError("unreachable", "could not be reached");
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      response.destroy();
      const location = header(response.headers.location);
      if (!location) throw new RemoteImageError("http_error", "redirects nowhere");
      if (hop >= maxRedirects) {
        throw new RemoteImageError("too_many_redirects", "redirects too many times");
      }
      url = parseHttpsUrl(location, url);
      continue;
    }
    if (response.status !== 200) {
      response.destroy();
      throw new RemoteImageError("http_error", `could not be downloaded (HTTP ${response.status})`);
    }

    const contentType = mimeEssence(header(response.headers["content-type"]));
    if (!contentType.startsWith("image/")) {
      response.destroy();
      throw new RemoteImageError("not_image", "is not an image");
    }
    const declared = Number(header(response.headers["content-length"]));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      response.destroy();
      throw tooLarge();
    }

    const chunks: Buffer[] = [];
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > options.maxBytes) {
          response.destroy();
          throw tooLarge();
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof RemoteImageError) throw error;
      if (signal.aborted) throw timedOut();
      throw new RemoteImageError("unreachable", "stopped answering half-way");
    }
    if (received === 0) throw new RemoteImageError("not_image", "is an empty file");

    return { buffer: Buffer.concat(chunks), contentType, fileName: fileNameFor(url, contentType) };
  }
}

/** The largest picture the store accepts, capped for a server-side fetch. */
export function remoteImageByteLimit(config: Pick<StorageConfig, "maxImageSizeMB">): number {
  const configured = Number(config.maxImageSizeMB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_IMAGE_MB;
  return Math.min(megabytes * MB, ABSOLUTE_MAX_IMAGE_BYTES);
}

/**
 * Download a picture and store it the way the media library stores an upload
 * (WebP where the pipeline converts, the store's limits, the owner's folder).
 * Returns the stored file; its `key` is what to delete if the caller gives up.
 */
export async function importRemoteImage(
  rawUrl: string,
  options: {
    /** `vendor/<id>` — the folder the media library shows that store. */
    ownerScope?: string;
    uploadedBy?: string;
    config?: StorageConfig;
    storage?: StorageService;
    transport?: RemoteImageTransport;
  } = {},
): Promise<UploadedMediaRecord> {
  const config = options.config ?? (await getStorageConfig());
  const image = await fetchRemoteImage(rawUrl, {
    maxBytes: remoteImageByteLimit(config),
    transport: options.transport,
  });
  const storage = options.storage ?? (await getStorageService());
  const bytes = new Uint8Array(image.buffer);

  try {
    return await uploadMediaFile(
      {
        name: image.fileName,
        type: image.contentType,
        size: image.buffer.length,
        arrayBuffer: async () => bytes.buffer,
      },
      {
        config,
        storage,
        uploadedBy: options.uploadedBy,
        ownerScope: options.ownerScope,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // The pipeline's own refusals are about the file; anything else is the
    // storage itself failing, which the caller reports differently.
    if (/too large/i.test(message)) {
      throw new RemoteImageError("too_large", "is larger than the store's image limit");
    }
    if (/unable to (read|convert)|missing image dimensions|not allowed|not valid/i.test(message)) {
      throw new RemoteImageError("unreadable", "is not an image the store can use");
    }
    throw error;
  }
}
