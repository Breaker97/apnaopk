/**
 * `pnpm db:migrate` — the one entry point for every upgrade migration.
 *
 *   pnpm db:migrate --list                    # what exists, grouped by release
 *   pnpm db:migrate <name> --dry-run          # report, write nothing
 *   pnpm db:migrate <name>                    # apply
 *   pnpm db:migrate --all --dry-run           # dry-run the whole set, in order
 *   pnpm db:migrate --all --yes               # apply the whole set, in order
 *   pnpm db:migrate ledger -- --rebuild       # pass flags to the script itself
 *
 * This replaced 86 package.json entries — a `db:migrate:<name>` and a
 * `db:migrate:<name>:dry` for each of 43 migrations — that differed only in a
 * filename and a `--dry-run`. The table they encoded now lives in
 * `scripts/migrations.mjs`; this file is only the dispatcher.
 *
 * It runs each migration as its own child process, with the same runner,
 * env-file flags and arguments the individual scripts used before, so nothing
 * about HOW a migration executes changed — only how it is named.
 */

import path from "path";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {
  MIGRATIONS,
  RELEASES,
  autoMigrations,
  envFileFlags,
  getMigration,
  manualMigrations,
  migrationArgs,
  needLabel,
} from "./migrations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

/**
 * Resolve `tsx` from the project's own node_modules rather than trusting PATH.
 *
 * pnpm puts `node_modules/.bin` on PATH for a script it launches, so a bare
 * `tsx` works under `pnpm db:migrate` — but not when this file is run directly
 * (`node scripts/migrate.mjs`), which is how the prebuilt Docker image and
 * anyone debugging invokes it. Falling back to the bare name keeps a global
 * install working if the local one is somehow absent.
 */
function resolveRunner(runner) {
  if (runner !== "tsx") return process.execPath;
  const local = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  return existsSync(local) ? local : "tsx";
}

const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * Split argv into the flags this runner owns and the rest, which is forwarded
 * verbatim to the migration. `--` is the explicit boundary for anything that
 * would otherwise be ambiguous (`pnpm db:migrate ledger -- --rebuild`), but
 * unknown flags before it pass through too, so `--geocode` works without it.
 */
function parseArgs(argv) {
  const own = { list: false, all: false, dryRun: false, yes: false, help: false };
  const positional = [];
  const extra = [];
  let afterDoubleDash = false;

  for (const arg of argv) {
    if (afterDoubleDash) {
      extra.push(arg);
      continue;
    }
    switch (arg) {
      case "--":
        afterDoubleDash = true;
        break;
      case "--list":
      case "-l":
        own.list = true;
        break;
      case "--all":
        own.all = true;
        break;
      case "--dry-run":
      case "--dry":
        own.dryRun = true;
        break;
      case "--yes":
      case "-y":
        own.yes = true;
        break;
      case "--help":
      case "-h":
        own.help = true;
        break;
      default:
        if (arg.startsWith("-")) extra.push(arg);
        else positional.push(arg);
    }
  }
  return { ...own, positional, extra };
}

function printHelp() {
  console.log(`
${BOLD}pnpm db:migrate${RESET} — run an upgrade migration.

  ${BOLD}pnpm db:migrate --list${RESET}                  every migration, grouped by release
  ${BOLD}pnpm db:migrate <name> --dry-run${RESET}        report what it would do, write nothing
  ${BOLD}pnpm db:migrate <name>${RESET}                  apply it
  ${BOLD}pnpm db:migrate --all --dry-run${RESET}         dry-run the whole set, in upgrade order
  ${BOLD}pnpm db:migrate --all --yes${RESET}             apply the whole set, in upgrade order

Flags the runner does not recognise are passed to the migration:

  ${BOLD}pnpm db:migrate location-geo --geocode${RESET}  resolve addresses through a geocoding API
  ${BOLD}pnpm db:migrate ledger -- --rebuild${RESET}     re-post the ledger after a rule change

${DIM}Always dry-run first. A dry pass that reports 0 is a migration you can skip.
See docs/UPGRADE.md for which migrations each release needs.${RESET}
`);
}

function printList() {
  console.log(`\n${BOLD}Migrations${RESET} ${DIM}(${MIGRATIONS.length} total)${RESET}`);
  for (const release of RELEASES) {
    const group = MIGRATIONS.filter((m) => m.since === release);
    if (group.length === 0) continue;
    console.log(`\n${BOLD}  ${release}${RESET} ${DIM}— ${group.length} migrations${RESET}`);
    const width = Math.max(...group.map((m) => m.name.length));
    for (const migration of group) {
      const flag = migration.auto ? " " : "*";
      console.log(
        `   ${flag} ${migration.name.padEnd(width)}  ${DIM}${needLabel(migration)}${RESET}`,
      );
      console.log(`     ${" ".repeat(width)}  ${migration.summary}`);
      for (const option of migration.options ?? []) {
        console.log(
          `     ${" ".repeat(width)}  ${DIM}${option} — ${migration.optionNotes?.[option] ?? ""}${RESET}`,
        );
      }
    }
  }
  const manual = manualMigrations();
  if (manual.length > 0) {
    console.log(
      `\n${DIM}  * excluded from --all (${manual.map((m) => m.name).join(", ")}) — run these deliberately.${RESET}`,
    );
  }
  console.log(
    `\n${DIM}  pnpm db:migrate <name> --dry-run    reports without writing${RESET}\n`,
  );
}

/** Did the user mean one of the real names? Cheap edit-distance suggestion. */
function suggest(name) {
  const distance = (a, b) => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [
      i,
      ...Array(b.length).fill(0),
    ]);
    for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return rows[a.length][b.length];
  };
  return MIGRATIONS.map((m) => ({ name: m.name, d: distance(name, m.name) }))
    .filter((m) => m.d <= Math.max(3, Math.floor(name.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((m) => m.name);
}

function runMigration(migration, { dryRun, extra }) {
  const args = [
    ...envFileFlags(migration),
    path.join("scripts", migration.script),
    ...migrationArgs(migration, { dryRun, extra }),
  ];
  const command = resolveRunner(migration.runner);

  console.log(
    `\n${BOLD}▶ ${migration.name}${RESET}${dryRun ? ` ${DIM}(dry run)${RESET}` : ""}`,
  );
  console.log(`${DIM}  ${migration.runner} ${args.join(" ")}${RESET}\n`);

  return new Promise((resolve) => {
    // cwd is the project root so the `--env-file=.env` paths above resolve the
    // same way they did when each migration was its own package.json script.
    // `shell: true` on Windows, where the tsx bin is a .cmd shim execvp cannot
    // launch directly.
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: ROOT,
      shell: process.platform === "win32",
    });
    child.on("error", (error) => {
      console.error(`\n❌ Could not start ${command}: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return 0;
  }
  if (options.list) {
    printList();
    return 0;
  }

  if (options.all) {
    if (options.positional.length > 0) {
      console.error(
        `❌ --all runs every migration, so it takes no name (got "${options.positional[0]}").`,
      );
      return 1;
    }
    return runAll(options);
  }

  const [name, ...rest] = options.positional;
  if (!name) {
    printHelp();
    return 1;
  }
  if (rest.length > 0) {
    console.error(
      `❌ One migration at a time (got "${name}" and "${rest[0]}"). Use --all for the whole set.`,
    );
    return 1;
  }

  const migration = getMigration(name);
  if (!migration) {
    const near = suggest(name);
    console.error(
      `❌ No migration named "${name}".` +
        (near.length ? `\n   Did you mean: ${near.join(", ")}?` : "") +
        `\n   Run \`pnpm db:migrate --list\` to see all ${MIGRATIONS.length}.`,
    );
    return 1;
  }

  return runMigration(migration, {
    dryRun: options.dryRun,
    extra: options.extra,
  });
}

async function runAll(options) {
  const queue = autoMigrations();
  const skipped = manualMigrations();

  if (options.extra.length > 0) {
    console.error(
      `❌ --all cannot forward migration flags (${options.extra.join(" ")}) — ` +
        "they mean different things to different scripts. Run that one on its own.",
    );
    return 1;
  }

  // Applying 30-odd migrations unattended is not something to do by typo. The
  // dry pass is free and is what the upgrade guide tells people to read first,
  // so it is the only form of --all that runs without an explicit --yes.
  if (!options.dryRun && !options.yes) {
    console.error(
      `❌ \`--all\` would APPLY ${queue.length} migrations to ` +
        `${process.env.MONGODB_DB_NAME || "the database in MONGODB_URI"}.\n\n` +
        "   Dry-run the set and read the output first:\n" +
        "     pnpm db:migrate --all --dry-run\n\n" +
        "   Then, once you have a backup:\n" +
        "     pnpm db:migrate --all --yes",
    );
    return 1;
  }

  console.log(
    `\n${BOLD}Running ${queue.length} migrations${RESET}` +
      `${options.dryRun ? ` ${DIM}(dry run — nothing is written)${RESET}` : ""}`,
  );

  const results = [];
  for (const migration of queue) {
    const code = await runMigration(migration, {
      dryRun: options.dryRun,
      extra: [],
    });
    results.push({ migration, code });
    if (code !== 0) {
      // Stop on the first failure: these are ordered, and a later migration
      // may assume an earlier one landed.
      console.error(
        `\n❌ ${migration.name} exited ${code}. Stopping — the rest of the set ` +
          "assumes it succeeded.\n" +
          `   Fix it, then resume with the migrations after it, or re-run --all ` +
          "(the ones that already ran are idempotent).",
      );
      break;
    }
  }

  const failed = results.filter((r) => r.code !== 0);
  const ran = results.filter((r) => r.code === 0);

  console.log(`\n${BOLD}${"─".repeat(60)}${RESET}`);
  console.log(
    `${ran.length}/${queue.length} ${options.dryRun ? "dry-ran" : "applied"}` +
      (failed.length ? `, ${failed.length} failed` : ""),
  );
  if (skipped.length > 0) {
    console.log(`\n${BOLD}Not included in --all:${RESET}`);
    for (const migration of skipped) {
      console.log(
        `  ${migration.name} ${DIM}— ${migration.autoReason}${RESET}\n` +
          `    ${DIM}pnpm db:migrate ${migration.name} --dry-run${RESET}`,
      );
    }
  }
  console.log("");

  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("\n❌ db:migrate failed:", error);
    process.exit(1);
  });
