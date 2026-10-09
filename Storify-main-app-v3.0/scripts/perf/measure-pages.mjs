#!/usr/bin/env node
/**
 * Page-weight and TTFB probe against a running Storify server.
 *
 *   pnpm perf:pages                                  # http://localhost:3000
 *   pnpm perf:pages --base http://localhost:3100 --hits 5
 *   pnpm perf:pages --paths /en,/en/cart --json after.json
 *
 * For every path it reports the served HTML (raw and gzip), the RSC payload
 * embedded in it, the next-intl messages blob the page ships to the client,
 * the number of script tags, and TTFB / total time over N warm hits (the
 * first, cache-filling hit is discarded). Dependency-free and deterministic,
 * so two `--json` files diffed against each other are the record of what an
 * optimisation actually changed. Run it against `next start`, never `next
 * dev`: dev output is neither minified nor representative.
 */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const args = parseArgs(process.argv.slice(2));
const base = String(args.base || "http://localhost:3000").replace(/\/$/, "");
const hits = Math.max(1, Number(args.hits) || 3);
const paths = args.paths
  ? String(args.paths).split(",").map((p) => p.trim()).filter(Boolean)
  : await defaultPaths(base);

const rows = [];
for (const path of paths) rows.push(await measure(path));

printTable(rows);
if (args.json) {
  writeFileSync(String(args.json), JSON.stringify({ base, hits, rows }, null, 2));
  console.log(`\nwrote ${args.json}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

/** Home, listing, the first product linked from home, cart, about. */
async function defaultPaths(baseUrl) {
  const home = await (await fetch(`${baseUrl}/en`)).text();
  const product = home.match(/\/en\/products\/[a-z0-9-]+/)?.[0];
  return ["/en", "/en/products", ...(product ? [product] : []), "/en/cart", "/en/about"];
}

async function measure(path) {
  const url = `${base}${path}`;
  // Cache-filling hit: sizes come from this body, timings do not.
  const first = await fetch(url);
  const html = await first.text();

  const ttfb = [];
  const total = [];
  for (let i = 0; i < hits; i += 1) {
    const started = performance.now();
    const res = await fetch(url);
    ttfb.push(performance.now() - started);
    await res.text();
    total.push(performance.now() - started);
  }

  const pushes = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/gs)].map(
    (m) => m[1],
  );
  const rscBytes = pushes.reduce((sum, p) => sum + p.length, 0);

  return {
    path,
    status: first.status,
    htmlBytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html).length,
    rscBytes,
    messagesBytes: messagesBlobBytes(pushes),
    scripts: (html.match(/<script[^>]*\ssrc=/g) || []).length,
    ttfbMs: median(ttfb),
    totalMs: median(total),
  };
}

/**
 * Size of the `messages` object next-intl serialises into the RSC payload —
 * the part of the HTML that is pure translation data.
 */
function messagesBlobBytes(pushes) {
  if (pushes.length === 0) return 0;
  const decoded = pushes
    .map((push) => {
      try {
        return JSON.parse(`"${push}"`);
      } catch {
        return push;
      }
    })
    .join("");
  // The provider's props serialise as `"locale":"en","messages":{…}`; fall
  // back to any `messages` key when the props order changes.
  const marker = '"messages":{';
  const anchored = decoded.search(/"locale":"[A-Za-z-]+","messages":\{/);
  const start =
    anchored >= 0 ? decoded.indexOf(marker, anchored) : decoded.indexOf(marker);
  if (start < 0) return 0;
  let depth = 0;
  let inString = false;
  for (let i = start + marker.length - 1; i < decoded.length; i += 1) {
    const ch = decoded[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return Buffer.byteLength(decoded.slice(start + marker.length - 1, i + 1));
    }
  }
  return 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function printTable(list) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const ms = (n) => `${n.toFixed(0)} ms`;
  const header = ["path", "status", "html", "gzip", "rsc", "messages", "scripts", "ttfb", "total"];
  const lines = list.map((r) => [
    r.path,
    String(r.status),
    kb(r.htmlBytes),
    kb(r.gzipBytes),
    kb(r.rscBytes),
    kb(r.messagesBytes),
    String(r.scripts),
    ms(r.ttfbMs),
    ms(r.totalMs),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(`${base}  (${hits} warm hits, medians)\n`);
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(fmt(l));
}
