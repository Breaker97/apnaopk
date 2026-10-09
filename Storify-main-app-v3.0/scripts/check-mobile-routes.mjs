#!/usr/bin/env node
/**
 * Does the build serve the mobile API the way its route files ask?
 *
 *   pnpm check:mobile-routes              # runs `next build`, then checks it
 *   pnpm check:mobile-routes --no-build   # checks the build already in .next
 *   NEXT_DIST_DIR=.next-x pnpm check:mobile-routes --no-build
 *
 * The mobile API caches some answers in Next's response cache (ISR): a route
 * file wrapped in `staticGet`, or the business app's `bizStaticGet`
 * (lib/api-next/routes.ts). Both apps' routes are checked. Whether Next really
 * does is decided at build time, from what the file exports, and the build's
 * route table cannot be trusted to say so (it prints the ISR marker for files
 * that end up dynamic). This reads the build's prerender manifest instead and
 * fails when:
 *
 * - a `staticGet` route is not an ISR route rendered on its first request
 *   (`dynamicRoutes`, `fallback: null`);
 * - any other mobile route is an ISR route;
 * - an ISR mobile route's file exports a method other than GET, which makes
 *   Next answer every request to it with a 500;
 * - anything under /api/mobile was rendered at build time;
 * - the build connected to a database. The build is run with MONGODB_URI
 *   pointed at a local listener that only counts connections, so no database
 *   is touched either way. (Skipped with --no-build.)
 *
 * Exit code 1 on any of these, so it can gate a CI job. Dependency-free.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { repairDynamicChunks } from "./check-dynamic-chunks.mjs";

const MOBILE_APP_DIR = join("app", "api", "mobile");
const WRITE_METHODS = /^export (const|async function|function) (POST|PUT|PATCH|DELETE|OPTIONS)\b/m;

function routeFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

/** "app/api/mobile/shop/v1/[locale]/config/route.ts" → "/api/mobile/shop/v1/[locale]/config". */
function routePattern(root, file) {
  return `/${relative(join(root, "app"), file).split(sep).slice(0, -1).join("/")}`;
}

/** Every problem the build in `distDir` has with the mobile routes in `root`. */
export function findMobileRouteProblems(root, distDir) {
  const manifestPath = join(distDir, "prerender-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No build at ${distDir} — run \`pnpm build\` first.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = [];

  for (const path of Object.keys(manifest.routes ?? {})) {
    if (path.startsWith("/api/mobile")) problems.push(`${path}: rendered at build time`);
  }

  const files = routeFiles(join(root, MOBILE_APP_DIR)).map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      file: relative(root, file),
      pattern: routePattern(root, file),
      isStatic: /\b(staticGet|bizStaticGet)\(/.test(source),
      hasWrites: WRITE_METHODS.test(source),
    };
  });
  const byPattern = new Map(files.map((entry) => [entry.pattern, entry]));
  const dynamicRoutes = manifest.dynamicRoutes ?? {};

  for (const entry of files) {
    const isr = dynamicRoutes[entry.pattern];
    if (entry.isStatic && !isr) {
      problems.push(`${entry.file}: staticGet route, but the build did not make it an ISR route`);
    } else if (entry.isStatic && isr.fallback !== null) {
      problems.push(`${entry.file}: ISR route with fallback ${JSON.stringify(isr.fallback)}, expected null (rendered on first request)`);
    } else if (!entry.isStatic && isr) {
      problems.push(`${entry.file}: not a staticGet route, but the build made it an ISR route`);
    }
  }
  for (const pattern of Object.keys(dynamicRoutes)) {
    if (!pattern.startsWith("/api/mobile")) continue;
    const entry = byPattern.get(pattern);
    if (!entry) problems.push(`${pattern}: ISR route with no route file under ${MOBILE_APP_DIR}`);
    else if (entry.hasWrites) {
      problems.push(`${entry.file}: ISR route that also exports a write method — Next answers every method with a 500`);
    }
  }

  return {
    problems,
    staticRoutes: files.filter((entry) => entry.isStatic).length,
    routes: files.length,
  };
}

/** Runs `next build` with MONGODB_URI pointed at a listener; resolves to the connections it saw. */
async function buildCountingDatabaseConnections(root) {
  let connections = 0;
  const sentinel = net.createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => sentinel.listen(0, "127.0.0.1", resolve));
  const { port } = sentinel.address();
  const nextBin = createRequire(join(root, "package.json")).resolve("next/dist/bin/next");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [nextBin, "build"], {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          MONGODB_URI: `mongodb://127.0.0.1:${port}/build-sentinel?directConnection=true&serverSelectionTimeoutMS=2000`,
          MONGODB_DB_NAME: "build-sentinel",
        },
      });
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`next build exited with ${code}`);
    // What `pnpm build` does after `next build`, so the CI job checks the
    // build that ships (scripts/check-dynamic-chunks.mjs).
    repairDynamicChunks(process.env.NEXT_DIST_DIR || ".next");
    // A connection attempted by the last worker lands a moment after exit.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return connections;
  } finally {
    sentinel.close();
  }
}

async function main() {
  const root = process.cwd();
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const build = !process.argv.includes("--no-build");

  const connections = build ? await buildCountingDatabaseConnections(root) : undefined;
  const { problems, staticRoutes, routes } = findMobileRouteProblems(root, distDir);
  if (connections) {
    problems.push(
      `the build connected to a database ${connections} time(s). Something runs a query at import or at build time; ` +
        "trace it with a MongoClient.prototype.connect hook under NODE_OPTIONS=--require.",
    );
  }

  if (problems.length > 0) {
    console.error(`check:mobile-routes — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check:mobile-routes — ${routes} mobile route file(s), ${staticRoutes} ISR, nothing prerendered` +
      (build ? ", no database connection during the build." : " (database check skipped: --no-build)."),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`check:mobile-routes — ${error.message}`);
    process.exitCode = 1;
  });
}
