"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlignLeft,
  ArrowUpRight,
  Contrast,
  Info,
  PanelLeftClose,
  Fingerprint,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import type { Settings } from "@/components/admin/settings/types";
import {
  NavColorCard,
  SectionContainer,
  SettingCard,
} from "@/components/admin/appearance-settings-ui";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

/**
 * Settings → Dashboard: how the ADMIN looks for the team. Contrast, text
 * direction, the collapsed sidebar and the nav color never touch the
 * storefront, which is why they stay here.
 *
 * Everything a shopper can see — logos, brand colors, the default light/dark
 * appearance — moved to Online Store → Themes → Branding, where it sits next
 * to the theme it dresses. The link card below is the trail for anyone who
 * remembers it living here.
 */
export function AppearanceSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const { locale } = useParams<{ locale: string }>();

  // Optional chaining + fallbacks throughout: legacy documents (set up on an
  // older schema) may be missing sub-objects or fields entirely.
  const appearance = props.settings?.appearance;

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.appearance.title", "Branding")}
        description={tSafe(
          "admin.settings.appearance.description",
          "How the admin looks for your team. Storefront branding lives in Online Store → Themes.",
        )}
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Fingerprint className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-semibold">
              {tSafe(
                "admin.settings.appearance.brandingMovedTitle",
                "Looking for logos and brand colors?",
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.appearance.brandingMovedDescription",
                "Brand assets, brand colors and the default light/dark appearance now live with your storefront theme, so everything shoppers see is edited in one place.",
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href={`/${locale}/admin/online-store/theme?tab=branding`}>
              {tSafe(
                "admin.settings.appearance.brandingMovedLink",
                "Open Theme Branding",
              )}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <SettingCard
              icon={<Contrast className="h-5 w-5" strokeWidth={1.5} />}
              label={t("admin.settings.appearance.contrast")}
              checked={Boolean(appearance?.contrast)}
              onCheckedChange={(checked) =>
                props.updateNestedField("appearance.contrast", checked)
              }
            />
            <SettingCard
              icon={<AlignLeft className="h-5 w-5" strokeWidth={1.5} />}
              label={t("admin.settings.appearance.rtl")}
              checked={Boolean(appearance?.rtl)}
              onCheckedChange={(checked) =>
                props.updateNestedField("appearance.rtl", checked)
              }
            />
            <SettingCard
              icon={<PanelLeftClose className="h-5 w-5" strokeWidth={1.5} />}
              label={t("admin.settings.appearance.collapsedSidebar")}
              checked={Boolean(appearance?.collapsedSidebar)}
              onCheckedChange={(checked) =>
                props.updateNestedField("appearance.collapsedSidebar", checked)
              }
              hasInfo
            />
          </div>

          <SectionContainer
            label={t("admin.settings.appearance.nav")}
            icon={<Info className="h-2.5 w-2.5" />}
          >
            <div className="space-y-3">
              <span className="text-xs font-medium text-muted-foreground">
                {t("admin.settings.appearance.color")}
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <NavColorCard
                  label={t("admin.settings.appearance.navColor.integrate")}
                  isActive={appearance?.navColor === "integrate"}
                  onClick={() =>
                    props.updateNestedField("appearance.navColor", "integrate")
                  }
                />
                <NavColorCard
                  label={t("admin.settings.appearance.navColor.apparent")}
                  isActive={appearance?.navColor === "apparent"}
                  onClick={() =>
                    props.updateNestedField("appearance.navColor", "apparent")
                  }
                />
              </div>
            </div>
          </SectionContainer>

          <StickySaveFooter
            label={t("admin.settings.appearance.save")}
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
