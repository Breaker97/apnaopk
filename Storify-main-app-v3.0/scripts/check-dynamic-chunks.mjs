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
 *
 *   node scripts/check-dynamic-chunks.mjs --repair   # part of `pnpm build`
 *
 * --repair first corrects those entries, then reports what is left and exits
 * 0 either way (a wrong preload is not worth failing a deploy over; CI runs
 * the check without the flag). The name in the manifest is wrong, not the
 * build: the page's own scripts carry the loader the browser runs for that
 * import, with the files it really fetches. Where the page's scripts hold
 * exactly one such loader and every file in it exists, those files replace
 * the entry's list. Nothing else in the build reads these manifests' lists —
 * the server reads them per request to write the preload links.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

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

/**
 * The scripts an App Router page loads first (its layouts' and its own), from
 * the client reference manifest Next writes beside the page's folder. Empty
 * when there is none (a Pages Router page, a route handler).
 */
function pageEntryScripts(pageDir) {
  const path = `${pageDir}_client-reference-manifest.js`;
  if (!existsSync(path)) return [];
  const context = { globalThis: {} };
  vm.runInNewContext(readFileSync(path, "utf8"), context);
  const files = new Set();
  for (const manifest of Object.values(context.globalThis.__RSC_MANIFEST ?? {})) {
    for (const list of Object.values(manifest.entryJSFiles ?? {})) {
      for (const file of list) files.add(file);
    }
  }
  return [...files];
}

/**
 * The file lists of every async loader in `source` that resolves to module
 * `moduleId`: Turbopack writes each as
 * `<id>,e=>{e.v(t=>Promise.all(["static/chunks/a.js",…].map(t=>e.l(t))).then(()=>t(<moduleId>)))}`.
 */
function loaderFileLists(source, moduleId) {
  const loader = new RegExp(
    String.raw`[,\[]\d+,(\w)=>\{\1\.v\((\w)=>Promise\.all\((\[[^\]]*\])\.map\(\(?\w\)?=>\1\.l\(\w\)\)\)\.then\(\(\)=>\2\(${moduleId}\)\)\)\}`,
    "g",
  );
  return [...source.matchAll(loader)].map((match) => match[3]);
}

/**
 * Points each manifest entry that names a missing chunk at the files the
 * page's own loader for that import fetches (see the header). Returns the
 * entries it corrected, as `{ page, moduleId, from, to }`.
 */
export function repairDynamicChunks(distDir) {
  const server = join(distDir, "server");
  if (!existsSync(server)) {
    throw new Error(`No build at ${distDir} — run \`pnpm build\` first.`);
  }
  const exists = (file) => existsSync(join(distDir, file));
  const sources = new Map();
  const source = (file) => {
    if (!sources.has(file)) sources.set(file, readFileSync(join(distDir, file), "utf8"));
    return sources.get(file);
  };
  const repaired = [];
  for (const manifest of manifests(server)) {
    const entries = JSON.parse(readFileSync(manifest, "utf8"));
    const broken = Object.entries(entries).filter(([, entry]) =>
      (entry?.files ?? []).some((file) => !exists(file)),
    );
    if (broken.length === 0) continue;
    const scripts = pageEntryScripts(dirname(manifest)).filter(exists);
    let changed = false;
    for (const [moduleId, entry] of broken) {
      const lists = new Set(scripts.flatMap((file) => loaderFileLists(source(file), moduleId)));
      if (lists.size !== 1) continue;
      const files = JSON.parse([...lists][0]);
      if (files.length === 0 || !files.every(exists)) continue;
      repaired.push({
        page: relative(server, manifest).replace(`/${MANIFEST}`, ""),
        moduleId,
        from: entry.files,
        to: files,
      });
      entry.files = files;
      changed = true;
    }
    if (changed) writeFileSync(manifest, JSON.stringify(entries, null, 2));
  }
  return repaired;
}

function main() {
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const repair = process.argv.includes("--repair");
  if (repair) {
    const repaired = repairDynamicChunks(distDir);
    if (repaired.length > 0) {
      console.log(
        `check:chunks — pointed ${repaired.length} preload list(s) at the chunks their page really loads (vercel/next.js#99149):`,
      );
      for (const { page, moduleId } of repaired) {
        console.log(`  ${page}  (dynamic import, module ${moduleId})`);
      }
    }
  }
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
      "https://github.com/vercel/next.js/issues/99149). `pnpm build` corrects every",
      "one whose page carries the loader the browser uses (--repair); for these it",
      "found none. Undo or move the `dynamic()` boundary you added, or keep that",
      "component a static import, until a Next.js release ships the fix",
      "(https://github.com/vercel/next.js/pull/99150).",
    ].join("\n"),
  );
  if (!repair) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
