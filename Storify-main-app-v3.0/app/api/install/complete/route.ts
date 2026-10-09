import { USER_ROLES } from "@/config/app.config";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { audit, createSystemAuditContext } from "@/lib/audit";
import { successResponse } from "@/lib/api/response";
import { INSTALL_OUT_OF_STOCK_DISPLAY } from "@/lib/catalog/catalog-display";
import { STORAGE_CREDENTIAL_BLOCKS } from "@/lib/settings/credentials";
import {
  installCompletion,
  type InstallWarningCode,
} from "@/lib/install/completion";
import { createInstallAdmin } from "@/lib/install/create-admin";
import {
  installPayloadSchema,
  type InstallPayload,
} from "@/lib/install/payload";
import { importSampleCatalog } from "@/lib/install/sample-data";
import {
  assertInstallable,
  claimInstall,
  markInstalled,
  releaseInstallClaim,
} from "@/lib/install/status";
import { revalidateAllStorefrontContent } from "@/lib/cache-invalidation";
import { assertInstallToken } from "@/lib/install/install-token";
import { clearStorageConfigCache } from "@/lib/storage";
import { applyThemeStarter } from "@/lib/storefront/themes/apply-starter";
import { THEME_MANIFESTS } from "@/lib/storefront/themes/registry";
import { syncDefaultVendorWithSettings } from "@/lib/vendors/multi-vendor";
import {
  getSettings,
  Settings,
  type ISettingsData,
} from "@/models/settings.model";

/**
 * Dotted `$set` paths for the chosen backend, or nothing at all when the
 * buyer chose to configure storage later.
 *
 * Credentials go into that provider's OWN block (`storage.r2.*`,
 * `storage.s3.*`, …), never the deprecated flat fields — the same rule the
 * admin save follows, so a wizard install and a hand-typed one leave an
 * identical document. Only the keys the provider actually uses are written:
 * an empty public URL must stay absent so `resolveStorageCredentials` can
 * still fall through to `STORAGE_PUBLIC_URL` from `.env`.
 */
function storageUpdates(
  storage: InstallPayload["storage"],
): Record<string, string> {
  if (!storage) return {};
  const { provider, ...credentials } = storage;
  const block = STORAGE_CREDENTIAL_BLOCKS[provider];
  const updates: Record<string, string> = { "storage.provider": provider };
  for (const [field, value] of Object.entries(credentials)) {
    if (typeof value === "string" && value.trim() !== "") {
      updates[`storage.${block}.${field}`] = value;
    }
  }
  return updates;
}

/**
 * The store's general and shipping settings as stored right now — read after
 * the store-basics write, never a document hydrated before it.
 */
async function readPersistedStoreSettings() {
  const settings = await Settings.findOne({})
    .select("general shipping")
    .lean<Pick<ISettingsData, "general" | "shipping"> | null>();
  if (!settings) throw new Error("The settings document is missing");
  return settings;
}

/**
 * The wizard's one-shot finish. Order is chosen for RECOVERABILITY:
 *
 *   settings → CLAIM → store basics → ADMIN → HOUSE PROFILE
 *            → sample → template → stamp
 *
 * The claim is the concurrency line: `assertInstallable()` is a read, so on
 * an unauthenticated endpoint two requests can both pass it and both create
 * a super-admin. One atomic conditional update settles who proceeds, and a
 * failure before the admin hands the claim straight back.
 *
 * Everything before the admin can be retried freely (the wizard stays
 * open). The moment the admin exists the wizard is locked by definition, so
 * nothing after it throws outward: the answer is always 200, and says in
 * `setupComplete` whether the store is ready (lib/install/completion.ts).
 *
 * - The house store profile is REQUIRED, demo data or not, marketplace or
 *   not: the product form, the inventory list and the POS all scope to it.
 *   When it cannot be made the optional steps are skipped and the owner is
 *   sent to Settings → General, whose save makes it.
 * - The sample catalog and the template are optional: a failure becomes a
 *   warning, and the buyer finishes them signed in (Products → Import, or
 *   Themes → Use this template).
 *
 * Either way the install is stamped and the caches expired. A locked
 * half-configured store beats an open wizard on a store with an admin.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "install:complete", preset: "moderate" },
  },
  async ({ request }) => {
    await assertInstallable();
    // Whoever finishes the wizard becomes the super-admin: only the owner,
    // who can read INSTALL_TOKEN from the server's .env, may.
    assertInstallToken(request);

    const body = await request.json().catch(() => null);
    const parsed = installPayloadSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid installation payload",
      );
    }
    const payload = parsed.data;

    const manifest = THEME_MANIFESTS.find(
      (candidate) =>
        candidate.id === payload.template && candidate.status === "stable",
    );
    if (!manifest) {
      throw new ValidationError("Unknown template");
    }

    // 1. Materialize the settings singleton with model defaults, so both the
    //    claim below and the $set after it land on a complete document.
    await getSettings();

    // 2. Take the one lease. `assertInstallable()` above is a READ, so two
    //    requests arriving together both pass it; this conditional update is
    //    atomic, so only one of them gets to create an admin. The loser is
    //    answered exactly like a post-install caller.
    if (!(await claimInstall())) {
      throw new NotFoundError("Not found");
    }

    let userId: string;
    try {
      const supported = payload.store.language === "en"
        ? ["en"]
        : ["en", payload.store.language];
      await Settings.updateOne(
        {},
        {
          $set: {
            "general.storeName": payload.store.name,
            "general.defaultLanguage": payload.store.language,
            "general.supportedLanguages": supported,
            "general.defaultCurrency": payload.store.currency,
            "multiVendorMode.enabled": payload.store.multiVendor,
            "pos.enabled": payload.store.pos,
            // A new store has no established grid order to disturb, so it opts
            // into the better default here rather than in the schema — where
            // the same value would silently reorder every existing store's
            // listings on its next upgrade.
            "catalog.outOfStockDisplay": INSTALL_OUT_OF_STOCK_DISPLAY,
            ...storageUpdates(payload.storage),
          },
        },
      );
      // The config is memoized for a minute; this process may already have
      // read the empty pre-install one while serving the wizard.
      clearStorageConfigCache();

      // 3. The admin — the last step that may refuse (password policy). It
      //    undoes its own half-made account if a later part of it fails, so
      //    a throw here leaves no admin behind. From here on the wizard is
      //    locked, so nothing below throws outward.
      ({ userId } = await createInstallAdmin(payload.admin));
    } catch (error) {
      // Nothing that locks the wizard happened: hand the lease straight back
      // so the buyer can correct their password and submit again, rather
      // than staring at a 404 until the lease expires. The store basics just
      // written are simply written again by that next attempt.
      await releaseInstallClaim().catch((releaseError: unknown) => {
        console.error("[install] The install lease was not released:", releaseError);
      });
      throw error;
    }

    // The admin exists, and nobody is signed in to be named as the one who made
    // them, so the row is the system's: it says how the store's first account
    // came to be, from where (the request's address and browser ride along), and
    // carries the address and nothing of the password.
    try {
      await audit(
        { ...createSystemAuditContext(), request },
        {
          action: "CREATE",
          resource: "user",
          resourceId: userId,
          resourceName: payload.admin.email,
          changes: {
            after: {
              name: payload.admin.name,
              email: payload.admin.email,
              role: USER_ROLES.ADMIN,
            },
            summary: `The first admin, ${payload.admin.email}, was created through the install wizard`,
          },
        },
      );
    } catch (error) {
      console.error("[install] The first admin's audit entry was not written:", error);
    }

    const warnings: InstallWarningCode[] = [];

    // 4. The house store profile (REQUIRED). Every admin-owned product, and
    //    every location the product form, inventory and POS offer, belongs
    //    to it — with multi-vendor on or off. Made from the settings as they
    //    are stored NOW, so it carries the name the buyer just typed; the
    //    same helper the General Settings save uses, so a failure here is
    //    repaired by exactly that save.
    let setupComplete = true;
    try {
      await syncDefaultVendorWithSettings(userId, await readPersistedStoreSettings());
    } catch (error) {
      setupComplete = false;
      console.error(
        "[install] The default store profile could not be created; " +
          "the owner is sent to Settings → General to repair it:",
        error,
      );
    }

    // 5. The chosen template's sample store (optional): its catalog AND the
    //    storefront that was designed around it, from the same snapshot
    //    `pnpm db:seed` uses. No logins and no orders — see sample-data.ts.
    let storefrontImported = false;
    if (payload.sampleData && !setupComplete) {
      warnings.push("sample_catalog_skipped");
    } else if (payload.sampleData) {
      try {
        const imported = await importSampleCatalog(userId, manifest.id, {
          // Vendor content ships only into a store that has vendors — the
          // demo's "Become a Vendor" banner and menu entry lead to a route
          // that redirects home when multi-vendor is off.
          multiVendor: payload.store.multiVendor,
          adminName: payload.admin.name,
        });
        storefrontImported = imported.storefrontImported;
        if (imported.created === 0) warnings.push("sample_catalog_empty");
      } catch (error) {
        console.error("[install] The sample catalog could not be imported:", error);
        warnings.push("sample_catalog_failed");
      }
    }

    // 6. The chosen template — the same path as the admin Themes page, AFTER
    //    the sample so the binder sees the catalog.
    //
    //    "keep" when the sample already published the demo's own storefront:
    //    the starter is the generic fallback for an empty store, and
    //    publishing it over a curated home page would replace the layout the
    //    buyer just picked the template FOR. Either way this is what flips
    //    `onlineStore.activeTheme` and seeds the theme's product card.
    if (!setupComplete) {
      warnings.push("template_skipped");
    } else {
      try {
        await applyThemeStarter(
          manifest,
          storefrontImported ? "keep" : "publish",
          userId,
        );
      } catch (error) {
        console.error("[install] The template could not be applied:", error);
        warnings.push("template_failed");
      }
    }

    // 7. Stamp the install. The admin alone already locks the wizard
    //    (`isInstallLocked`), so a failed stamp is logged, not reported as a
    //    failed install the buyer would then try to repeat.
    try {
      await markInstalled();
    } catch (error) {
      console.error("[install] The install stamp was not written:", error);
    }

    // 8. Serve the store just written, not what was cached before it — after
    //    a partial setup too. The theme starter expires the settings, but only
    //    when it runs and succeeds, and a reinstall on a running server still
    //    holds the previous store's catalog, menus, sliders and coupons.
    try {
      revalidateAllStorefrontContent();
    } catch (error) {
      console.error("[install] The storefront caches were not expired:", error);
    }

    return successResponse(installCompletion(setupComplete, warnings));
  },
);
