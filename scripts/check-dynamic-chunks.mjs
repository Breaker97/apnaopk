#!/usr/bin/env node
/**
 * After `pnpm build`: does every page preload only chunks that exist?
 *
 *   pnpm build && pnpm check:chunks
 *   NEXT_DIST_DIR=.next-perf pnpm check:chunks     # a build in another dist dir
 *
 * A component behind `next/dynamic` is preloaded with the HTML of any page
 * that renders it on the server, from the list in that page's
 * `react-loadable-manifest.json`. Next.js 16.3 with Turbopack can write a
 * chunk name into that list which it never writes to disk
 * (https://github.com/vercel/next.js/issues/99149, fix pending in
 * https://github.com/vercel/next.js/pull/99150): the page then asks for a file
 * that answers 404 — the whole "page not found" page, rendered by the server —
 * on every visit. The component itself still loads, from the browser's own
 * list, so nothing looks broken.
 *
 * Which page it hits depends on how the build splits its chunks, so it can
 * appear when a `dynamic()` boundary is added or moved anywhere, and the
 * source gives no sign of it. This reads every manifest of the build and
 * lists each chunk that is named but missing, with the pages and the dynamic
 * import (by module id) that name it. Exit code 1 when there is one, so it
 * can gate a CI job. Dependency-free.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "react-loadable-manifest.json";

function manifests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...manifests(path));
    else if (entry === MANIFEST) found.push(path);
  }
  return found;
}

/**
 * Every chunk a loadable manifest in `distDir` names that is not in the
 * build, as `{ file, pages: [{ page, moduleId }] }`.
 */
export function findMissingDynamicChunks(distDir) {
  const server = join(distDir, "server");
  if (!existsSync(server)) {
    throw new Error(`No build at ${distDir} — run \`pnpm build\` first.`);
  }
  const missing = new Map();
  let checked = 0;
  for (const manifest of manifests(server)) {
    const page = relative(server, manifest).replace(`/${MANIFEST}`, "");
    const entries = JSON.parse(readFileSync(manifest, "utf8"));
    for (const [moduleId, entry] of Object.entries(entries)) {
      for (const file of entry?.files ?? []) {
        checked += 1;
        if (existsSync(join(distDir, file))) continue;
        if (!missing.has(file)) missing.set(file, []);
        missing.get(file).push({ page, moduleId });
      }
    }
  }
  return {
    checked,
    missing: [...missing].map(([file, pages]) => ({ file, pages })),
  };
}

function main() {
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const { checked, missing } = findMissingDynamicChunks(distDir);
  if (missing.length === 0) {
    console.log(`check:chunks — ${checked} preloaded chunk references, all in ${distDir}.`);
    return;
  }
  console.error(
    `check:chunks — ${missing.length} chunk(s) named in a page's preload list but not in ${distDir}:`,
  );
  for (const { file, pages } of missing) {
    console.error(`  ${file}`);
    for (const { page, moduleId } of pages) {
      console.error(`      ${page}  (dynamic import, module ${moduleId})`);
    }
  }
  console.error(
    [
      "",
      "Those pages preload a file that answers 404 on every visit, where they render",
      "the dynamic component on the server (Next.js/Turbopack issue",
      "https://github.com/vercel/next.js/issues/99149). Undo or move the `dynamic()`",
      "boundary you added, or keep that component a static import, until a Next.js",
      "release ships the fix (https://github.com/vercel/next.js/pull/99150).",
    ].join("\n"),
  );
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
