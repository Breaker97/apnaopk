/**
 * What the install wizard's finish answers, shared by the route and the
 * wizard. Pure on purpose: the browser imports it.
 *
 * The finish always answers 200 once the admin exists, because from that
 * moment the public installer is locked (lib/install/status.ts) and a failure
 * status would only invite a second attempt that can never succeed. Whether
 * the store is actually ready is said here instead:
 *
 * - `setupComplete: true` — every REQUIRED step ran (store basics, admin,
 *   the house store profile). Optional steps that failed — the demo catalog,
 *   the template — are listed in `warnings`; the owner finishes them signed in.
 * - `setupComplete: false` — the admin exists but a required step did not
 *   run. The owner signs in and saves Settings → General, which repeats it
 *   (`recovery`). Optional steps were skipped and are listed in `warnings`.
 *
 * `warnings` are codes, never sentences: the wizard words them in the buyer's
 * language, and no exception text or install token reaches the public
 * response.
 */

export const INSTALL_WARNING_CODES = [
  /** The template ships no sample catalog; nothing was imported. */
  "sample_catalog_empty",
  /** The sample catalog import failed; the store starts empty. */
  "sample_catalog_failed",
  /** Not attempted, because a required step failed first. */
  "sample_catalog_skipped",
  /** The template could not be applied. */
  "template_failed",
  /** Not attempted, because a required step failed first. */
  "template_skipped",
] as const;

export type InstallWarningCode = (typeof INSTALL_WARNING_CODES)[number];

/** The one recovery path: sign in, then save Settings → General. */
export const INSTALL_RECOVERY = "sign_in_and_save_general_settings" as const;

export type InstallCompletion =
  | { ok: true; setupComplete: true; warnings: InstallWarningCode[] }
  | {
      ok: false;
      setupComplete: false;
      warnings: InstallWarningCode[];
      recovery: typeof INSTALL_RECOVERY;
    };

export function installCompletion(
  setupComplete: boolean,
  warnings: InstallWarningCode[],
): InstallCompletion {
  return setupComplete
    ? { ok: true, setupComplete: true, warnings }
    : { ok: false, setupComplete: false, warnings, recovery: INSTALL_RECOVERY };
}

/**
 * Reads a finish answer defensively: an answer without `setupComplete` is
 * from a server that predates it, which only ever reported complete setups;
 * a warning this build does not know is dropped rather than shown raw.
 */
export function readInstallCompletion(data: unknown): InstallCompletion {
  const value = (data ?? {}) as {
    setupComplete?: unknown;
    warnings?: unknown;
  };
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((code): code is InstallWarningCode =>
        (INSTALL_WARNING_CODES as readonly unknown[]).includes(code),
      )
    : [];
  return installCompletion(value.setupComplete !== false, warnings);
}
