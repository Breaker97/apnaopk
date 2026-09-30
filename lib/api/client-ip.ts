/**
 * The client's IP address, as the proxies in front of this app report it.
 *
 * Every limit keyed on an address — the API rate limits, the login lockout,
 * Better Auth's sign-in limit, the maintenance allow-list — depends on this
 * being the visitor and not something the visitor typed. The old rule took the
 * LEFTMOST `X-Forwarded-For` entry, which is whatever the client sent: behind
 * nginx's usual `$proxy_add_x_forwarded_for`, or on a bare `next start`, one
 * made-up header per request walked past every one of those limits.
 *
 * The chain is read from the right instead. Each proxy appends the address it
 * saw, so walking right to left and skipping the proxies this deployment
 * trusts, the first untrusted address is the client. Trusted by default: the
 * private, loopback and link-local ranges a reverse proxy on the same host or
 * network connects from. `TRUSTED_PROXIES` adds more — IPs, CIDR ranges, or the
 * word `cloudflare` for Cloudflare's published ranges — and a store behind any
 * other CDN must list it, or every visitor arrives as one of the CDN's
 * addresses and shares its limits with everyone else there.
 *
 * Cloudflare needs no entry. When one of its addresses hands a request over,
 * the visitor is the one it names in `CF-Connecting-IP`, a header only
 * Cloudflare writes: a visitor cannot send it through Cloudflare, and a
 * Worker cannot set it (from another zone it arrives as the fixed
 * 2a06:98c0:3600::103; to a store off Cloudflare it is the address that
 * called the Worker). Most stores that add Cloudflare never learn of
 * `TRUSTED_PROXIES`, and without this every shopper routed through the same
 * edge shared one cart, search, sign-in and checkout allowance.
 *
 * What no header rule can fix is an app port the internet reaches directly.
 * Next.js writes the socket address into `X-Forwarded-For` only when a request
 * arrives without one, so a client talking straight to `next start` still
 * picks its own address. Production has a proxy in front for TLS anyway; the
 * app's own port must be reachable only through it.
 *
 * Pure string work, no Node APIs: the proxy (proxy.ts) runs this too.
 */

/**
 * Where proxy.ts records the address it resolved, for Better Auth to read
 * (`advanced.ipAddress.ipAddressHeaders`). Every /api/auth request passes
 * through the proxy, which overwrites whatever a client sent under this name.
 */
export const CLIENT_IP_HEADER = "x-storify-client-ip";

/** Cloudflare's published ranges (cloudflare.com/ips), checked 2026-09-25. */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const PRIVATE_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

type Range = { bytes: number[]; prefix: number };

function parseIPv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function parseIPv6(value: string): number[] | null {
  let text = value.toLowerCase();
  let tail: number[] = [];
  // An embedded IPv4 tail (::ffff:203.0.113.9) supplies the last 4 bytes.
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part ? part.split(":") : []);
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const word = parseInt(group, 16);
    bytes.push(word >> 8, word & 255);
  }
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

/**
 * Bytes of an address, with IPv4-mapped IPv6 (`::ffff:a.b.c.d`) folded to
 * IPv4 so it matches IPv4 ranges. A trailing port (`a.b.c.d:1234`,
 * `[::1]:1234`), which some proxies include, is dropped.
 */
function toBytes(raw: string): number[] | null {
  let value = raw.trim();
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.split(":")[0];

  if (!value.includes(":")) return parseIPv4(value);
  const bytes = parseIPv6(value);
  if (!bytes) return null;
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 255 &&
    bytes[11] === 255;
  return mapped ? bytes.slice(12) : bytes;
}

function format(bytes: number[]): string {
  if (bytes.length === 4) return bytes.join(".");
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }
  return groups.join(":");
}

function parseRange(entry: string): Range | null {
  const [address, prefixText] = entry.trim().split("/");
  const bytes = address ? toBytes(address) : null;
  if (!bytes) return null;
  const max = bytes.length * 8;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { bytes, prefix };
}

function inRange(bytes: number[], range: Range): boolean {
  if (bytes.length !== range.bytes.length) return false;
  let bits = range.prefix;
  for (let i = 0; i < bytes.length && bits > 0; i++) {
    const take = Math.min(bits, 8);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (range.bytes[i] & mask)) return false;
    bits -= 8;
  }
  return true;
}

/**
 * The trusted proxy ranges: the private defaults plus `TRUSTED_PROXIES`
 * (comma or space separated; `cloudflare` expands to Cloudflare's ranges).
 * Entries that are not an IP or CIDR are ignored.
 */
export function parseTrustedProxies(value: string | undefined): Range[] {
  const entries = [...PRIVATE_RANGES];
  for (const token of (value || "").split(/[\s,]+/).filter(Boolean)) {
    if (token.toLowerCase() === "cloudflare") entries.push(...CLOUDFLARE_RANGES);
    else entries.push(token);
  }
  return entries
    .map(parseRange)
    .filter((range): range is Range => range !== null);
}

let configuredRanges: Range[] | null = null;

function trustedFromEnv(): Range[] {
  configuredRanges ??= parseTrustedProxies(process.env.TRUSTED_PROXIES);
  return configuredRanges;
}

let cloudflareRanges: Range[] | null = null;

function isCloudflare(bytes: number[]): boolean {
  cloudflareRanges ??= CLOUDFLARE_RANGES.map(parseRange).filter(
    (range): range is Range => range !== null,
  );
  return cloudflareRanges.some((range) => inRange(bytes, range));
}

type HeaderSource = { get(name: string): string | null };

function singleAddress(headers: HeaderSource, name: string): string | null {
  const bytes = toBytes(headers.get(name) || "");
  return bytes ? format(bytes) : null;
}

/**
 * The client's address, or null when the headers do not establish one.
 *
 * With `X-Forwarded-For`: walk from the right past trusted proxies. The first
 * Cloudflare address met hands over to the visitor Cloudflare names in
 * `CF-Connecting-IP`, trusted or not (see the top of this file); with no valid
 * header it is walked like any other hop. When every hop is a trusted proxy —
 * a CDN that replaced the chain with its own address, say — the client is the
 * one that proxy names in its own header (`CF-Connecting-IP`), then
 * `X-Real-IP`. Garbage met before an untrusted address means the chain cannot
 * be trusted at all.
 *
 * Without it: `X-Real-IP` (what nginx and Traefik set from the socket), then
 * `CF-Connecting-IP`.
 */
export function resolveClientIp(
  headers: HeaderSource,
  trusted: Range[] = trustedFromEnv(),
): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const bytes = toBytes(hops[i]);
      if (!bytes) return null;
      if (isCloudflare(bytes)) {
        const named = singleAddress(headers, "cf-connecting-ip");
        if (named) return named;
      }
      if (trusted.some((range) => inRange(bytes, range))) continue;
      return format(bytes);
    }
    if (hops.length > 0) {
      return (
        singleAddress(headers, "cf-connecting-ip") ??
        singleAddress(headers, "x-real-ip")
      );
    }
  }

  return (
    singleAddress(headers, "x-real-ip") ??
    singleAddress(headers, "cf-connecting-ip")
  );
}

/**
 * Records the resolved address under CLIENT_IP_HEADER, replacing anything the
 * client sent under that name; removes it when no address can be resolved.
 */
export function stampClientIp(headers: Headers): void {
  const ip = resolveClientIp(headers);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  else headers.delete(CLIENT_IP_HEADER);
}
