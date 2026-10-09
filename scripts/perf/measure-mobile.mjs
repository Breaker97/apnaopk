#!/usr/bin/env node
/**
 * The mobile API against its budgets, on a running server.
 *
 *   pnpm perf:mobile --base http://localhost:3115 \
 *     --mongo "mongodb://127.0.0.1:27115/?directConnection=true" --db storify_x
 *   pnpm perf:mobile ... --hits 50 --json after.json
 *   pnpm perf:mobile ... --check          # exit 1 when a budget is broken
 *
 * Run it against `next build` + `next start` with the API switched on (Settings
 * → Mobile app) and a seeded catalogue; `next dev` numbers mean nothing. For
 * each endpoint: one hit to fill the caches, then `--hits` warm ones, and it
 * reports the payload raw and gzipped (route handlers go out uncompressed;
 * compression is the reverse proxy's), p50/p95 over loopback (close to server
 * time), whether the answer came from the response cache, and the database
 * operations the warm hits made, counted by MongoDB's own profiler.
 *
 * The profiler is switched on for the run and back to its old level after.
 * It is only ever touched on a database at a loopback address: never point
 * this at a shared database. Without --mongo the operation column is blank.
 *
 * Public endpoints get a fresh X-Install-Id per request, so the run is never
 * slowed by its own rate limit.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const args = parseArgs(process.argv.slice(2));
const base = String(args.base || "http://localhost:3000").replace(/\/$/, "");
const locale = String(args.locale || "en");
const hits = Math.max(1, Number(args.hits) || 20);
const api = `${base}/api/mobile/shop/v1/${locale}`;

/**
 * The budgets, settled from the first measurements (2026-10-01, seeded
 * Electronics catalogue, loopback). `ops` is per warm request; `gzipKB` and
 * `p95ms` are ceilings. Static answers come from the response cache, so their
 * warm cost is the cache's alone.
 */
const BUDGETS = {
  config: { ops: 0, gzipKB: 8, p95ms: 20 },
  home: { ops: 0, gzipKB: 40, p95ms: 20 },
  categories: { ops: 0, gzipKB: 8, p95ms: 20 },
  "product detail": { ops: 0, gzipKB: 25, p95ms: 20 },
  "collection detail": { ops: 0, gzipKB: 4, p95ms: 20 },
  "brand detail": { ops: 0, gzipKB: 4, p95ms: 20 },
  "vendor detail": { ops: 0, gzipKB: 4, p95ms: 20 },
  "product list (20)": { ops: 0, gzipKB: 12, p95ms: 100 },
  "product search": { ops: 0, gzipKB: 12, p95ms: 100 },
  "collection products": { ops: 0, gzipKB: 12, p95ms: 100 },
  facets: { ops: 0, gzipKB: 4, p95ms: 100 },
  collections: { ops: 0, gzipKB: 8, p95ms: 100 },
  brands: { ops: 0, gzipKB: 8, p95ms: 100 },
  vendors: { ops: 0, gzipKB: 8, p95ms: 100 },
  // Read per request, like the web's (lib/catalog/product-reviews.ts): the
  // page, its reviewers, the summary.
  reviews: { ops: 3, gzipKB: 8, p95ms: 100 },
};

const profiler = args.mongo ? await openProfiler(String(args.mongo), String(args.db || "")) : null;
try {
  const targets = await discoverTargets();
  const rows = [];
  for (const target of targets) rows.push(await measure(target));
  printTable(rows);
  if (args.json) {
    writeFileSync(String(args.json), JSON.stringify({ base, locale, hits, rows }, null, 2));
    console.log(`\nwrote ${args.json}`);
  }
  const broken = rows.flatMap((row) => row.broken.map((what) => `${row.name}: ${what}`));
  if (broken.length > 0) {
    console.log(`\nOver budget:\n  ${broken.join("\n  ")}`);
    if (args.check) process.exitCode = 1;
  } else {
    console.log("\nEvery endpoint within its budget.");
  }
} finally {
  await profiler?.close();
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

async function getJson(path) {
  const response = await fetch(`${api}${path}`, { headers: { "X-Install-Id": randomUUID() } });
  if (!response.ok) return null;
  return (await response.json()).data;
}

/** Real slugs from the store itself, so the run needs no configuration. */
async function discoverTargets() {
  const config = await getJson("/config");
  if (!config) {
    throw new Error(`${api}/config did not answer: is the server up and Settings → Mobile app on?`);
  }
  const [list, collections, brands, vendors] = await Promise.all([
    getJson("/products?limit=20"),
    getJson("/collections"),
    getJson("/brands"),
    getJson("/vendors"),
  ]);
  const product = list?.items?.find((item) => !item.sponsored) ?? list?.items?.[0];
  const collection = collections?.items?.[0];
  const brand = brands?.items?.[0];
  const vendor = vendors?.items?.[0];
  const word = product?.name?.split(/\s+/)[0]?.toLowerCase();

  return [
    { name: "config", path: "/config" },
    { name: "home", path: "/home", optional: true },
    { name: "categories", path: "/categories" },
    product && { name: "product detail", path: `/products/${product.slug}` },
    collection && { name: "collection detail", path: `/collections/${collection.slug}` },
    brand && { name: "brand detail", path: `/brands/${brand.slug}` },
    vendor && { name: "vendor detail", path: `/vendors/${vendor.slug}` },
    { name: "product list (20)", path: "/products?limit=20" },
    word && { name: "product search", path: `/products?q=${encodeURIComponent(word)}` },
    collection && { name: "collection products", path: `/products?collection=${collection.slug}` },
    { name: "facets", path: "/products/facets" },
    { name: "collections", path: "/collections" },
    { name: "brands", path: "/brands" },
    vendor && { name: "vendors", path: "/vendors" },
    product && { name: "reviews", path: `/products/${product.slug}/reviews` },
  ].filter(Boolean);
}

async function hit(path) {
  const started = performance.now();
  const response = await fetch(`${api}${path}`, { headers: { "X-Install-Id": randomUUID() } });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    ms: performance.now() - started,
    status: response.status,
    cache: response.headers.get("x-nextjs-cache") ?? "",
    body,
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function measure(target) {
  // Fills the response cache and the data caches behind it.
  const first = await hit(target.path);
  if (first.status !== 200) {
    return {
      name: target.name,
      path: target.path,
      status: first.status,
      skipped: true,
      broken: target.optional ? [] : [`answered ${first.status}`],
    };
  }
  // A stale entry is regenerated behind the first answer; let it land.
  if (first.cache === "STALE") await hit(target.path);

  const since = await profiler?.mark();
  const times = [];
  const caches = new Set();
  for (let i = 0; i < hits; i += 1) {
    const warm = await hit(target.path);
    times.push(warm.ms);
    caches.add(warm.cache || "-");
  }
  const ops = profiler ? (await profiler.countSince(since)) / hits : null;

  const raw = first.body.length;
  const gzip = gzipSync(first.body).length;
  const row = {
    name: target.name,
    path: target.path,
    status: first.status,
    cache: [...caches].join("/"),
    rawKB: raw / 1024,
    gzipKB: gzip / 1024,
    p50ms: percentile(times, 0.5),
    p95ms: percentile(times, 0.95),
    ops,
    broken: [],
  };
  const budget = BUDGETS[target.name];
  if (budget) {
    if (row.gzipKB > budget.gzipKB) row.broken.push(`gzip ${row.gzipKB.toFixed(1)} KB > ${budget.gzipKB} KB`);
    if (row.p95ms > budget.p95ms) row.broken.push(`p95 ${row.p95ms.toFixed(1)} ms > ${budget.p95ms} ms`);
    if (ops !== null && ops > budget.ops) row.broken.push(`${ops.toFixed(1)} ops per request > ${budget.ops}`);
  }
  return row;
}

function printTable(rows) {
  const header = ["endpoint", "cache", "raw KB", "gzip KB", "p50 ms", "p95 ms", "ops/req", "budget"];
  const lines = rows.map((row) =>
    row.skipped
      ? [row.name, String(row.status), "", "", "", "", "", row.broken.length ? "FAIL" : "skipped"]
      : [
          row.name,
          row.cache,
          row.rawKB.toFixed(1),
          row.gzipKB.toFixed(1),
          row.p50ms.toFixed(2),
          row.p95ms.toFixed(2),
          row.ops === null ? "" : row.ops.toFixed(1),
          BUDGETS[row.name] ? (row.broken.length ? "FAIL" : "ok") : "",
        ],
  );
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length)),
  );
  const format = (cells) =>
    cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ");
  console.log(`${base}, locale ${locale}, ${hits} warm hits each\n`);
  console.log(format(header));
  for (const line of lines) console.log(format(line));
}

/** MongoDB's profiler on a loopback database: every operation it runs is counted by the server itself. */
async function openProfiler(uri, dbName) {
  if (!dbName) throw new Error("--mongo needs --db <database name>");
  const { MongoClient } = await import("mongodb");
  const client = await MongoClient.connect(uri, { appName: "perf-mobile" });
  const host = client.options.hosts.map((address) => String(address.host ?? address)).join(",");
  if (!/^(127\.0\.0\.1|localhost|::1|\[::1\])(:\d+)?$/.test(host)) {
    await client.close();
    throw new Error(`Refusing to profile ${host}: only a database on this machine.`);
  }
  const db = client.db(dbName);
  const before = await db.command({ profile: -1 });
  await db.command({ profile: 2 });
  return {
    async mark() {
      // The newest entry's time: everything after it is the run's.
      const [last] = await db
        .collection("system.profile")
        .find({}, { projection: { ts: 1 } })
        .sort({ $natural: -1 })
        .limit(1)
        .toArray();
      return last?.ts ?? new Date(0);
    },
    async countSince(since) {
      // The profiler records asynchronously; a moment lets the last ops land.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return db.collection("system.profile").countDocuments({
        ts: { $gt: since },
        ns: { $not: /\.system\.profile$/ },
        // The run's own reads of the profile are not the server's.
        "command.profile": { $exists: false },
        appName: { $ne: "perf-mobile" },
      });
    },
    async close() {
      await db.command({ profile: before.was ?? 0 });
      await client.close();
    },
  };
}
