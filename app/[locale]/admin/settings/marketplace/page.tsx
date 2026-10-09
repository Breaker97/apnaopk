"use client";

import { useTranslations } from "next-intl";
import { MarketplaceSettingsTab } from "@/components/admin/settings/sections/marketplace-settings-tab";
import { VendorPermissionsSettingsTab } from "@/components/admin/settings/sections/vendor-permissions-settings-tab";
import { PreorderSettingsTab } from "@/components/admin/settings/sections/preorder-settings-tab";
import { StickySaveFooter } from "@/components/admin/settings/sections/sticky-save-footer";
import { useAdminSettingsContext } from "@/components/admin/settings/admin-settings-context";
import { SectionLoader } from "@/components/admin/settings/section-loader";
import {
  pickPreorderRules,
  VENDOR_PREORDER_KEYS,
} from "@/components/admin/settings/preorder-rule-keys";
import type { Settings } from "@/components/admin/settings/types";

export default function Page() {
  const t = useTranslations();
  const {
    isSaving,
    dirtySections,
    updateFieldInSection,
    saveSection,
    saveSections,
    savedSettings,
    discardEdits,
  } = useAdminSettingsContext();

  const isMarketplaceDirty = dirtySections.has("multiVendorMode");
  const isPreorderDirty = dirtySections.has("preorder");

  // One bar saves the whole page. A bar per card once threw away the other
  // card's unsaved edits (a save adopted the whole server answer), and while
  // the bars were `fixed` the pre-order bar sat on top of the marketplace one
  // and swallowed its clicks. Both edited → one request, so the page saves or
  // fails as a whole. Of `preorder` only the vendor rules are this page's;
  // the rest is Settings → Products'.
  const save = (settings: Settings) => {
    const preorder = pickPreorderRules(settings.preorder, VENDOR_PREORDER_KEYS);
    if (isMarketplaceDirty && isPreorderDirty) {
      return saveSections({
        multiVendorMode: settings.multiVendorMode,
        preorder,
      });
    }
    if (isPreorderDirty) return saveSection("preorder", preorder);
    return saveSection("multiVendorMode", settings.multiVendorMode);
  };

  return (
    <SectionLoader>
      {(loadedSettings) => {
        const enabled = loadedSettings.multiVendorMode.enabled;
        return (
          <div className="space-y-4">
            <MarketplaceSettingsTab
              settings={loadedSettings}
              savedEnabled={savedSettings?.multiVendorMode?.enabled ?? enabled}
              updateField={(path, value) =>
                updateFieldInSection("multiVendorMode", path, value)
              }
            />
            {/* Everything under the switch is about vendors, so it goes when
                the marketplace does — the saved values stay as they are. */}
            {enabled ? (
              <>
                <VendorPermissionsSettingsTab
                  settings={loadedSettings}
                  savedSettings={savedSettings}
                  updateField={(path, value) =>
                    updateFieldInSection("multiVendorMode", path, value)
                  }
                />
                {/* Pre-order guard rails sit with the marketplace rather than
                    with Orders: what they bound is what a VENDOR may promise,
                    and the vendor approval queue lives inside them. */}
                <PreorderSettingsTab
                  settings={loadedSettings}
                  updateField={(path, value) =>
                    updateFieldInSection("preorder", path, value)
                  }
                />
              </>
            ) : null}
            <StickySaveFooter
              label={t("admin.settings.saveChanges")}
              isSaving={isSaving}
              isDirty={isMarketplaceDirty || isPreorderDirty}
              onSave={() => save(loadedSettings)}
              onDiscard={discardEdits}
            />
          </div>
        );
      }}
    </SectionLoader>
  );
}
