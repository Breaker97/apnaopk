"use client";

import { useState } from "react";
import { useRouter, usePathname } from "@/hooks/use-locale-navigation";
import { useTheme } from "@/providers/theme-provider";
import {
  Settings,
  X,
  RotateCcw,
  Moon,
  Contrast,
  AlignLeft,
  PanelLeftClose,
  Maximize2,
  Minimize2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppSettings } from "@/stores/app-settings";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { swapLocaleInPathname } from "@/providers/language-provider";
import { FlagIcon } from "@/components/ui/flag-icon";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/use-fullscreen";
import {
  NavColorCard,
  SectionContainer,
  SettingCard,
} from "@/components/admin/appearance-settings-ui";
import { confirmLeaveSettings } from "@/components/admin/settings/settings-leave-check";
import { useTranslations } from "next-intl";

/**
 * The viewer's own dashboard preferences, in every dashboard (admin, vendor,
 * staff): light/dark, contrast, right-to-left, a collapsed sidebar, the
 * sidebar colour, and the language. All of it stays in this browser and
 * changes nothing for anyone else.
 *
 * The store's look — logos, brand colours, presets, the default light/dark
 * shoppers see — is Online Store → Themes → Branding. This drawer used to
 * write it: a colour preset or Reset replaced the brand colours, and a dark
 * toggle turned the storefront dark for every shopper.
 */
export function PreferencesDrawer({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, clearTheme } = useTheme();
  const { isFullscreen, toggleFullscreen } = useFullscreen({
    onError: () => toast.error(t("admin.preferences.fullscreenUnavailable")),
  });

  const {
    contrast,
    rtl,
    collapsedSidebar,
    navColor,
    setContrast,
    setRtl,
    setCollapsedSidebar,
    setNavColor,
    resetPreferences,
  } = useAppSettings();

  const isRtl =
    rtl || (localeConfig[locale]?.direction ?? "ltr") === "rtl";

  const handleLocaleChange = async (newLocale: Locale) => {
    // `usePathname` here is the app's internal, always-prefixed spelling, and
    // `swapLocaleInPathname` is the one sanctioned way to move a path to
    // another language; the router drops the prefix again if the target is
    // the store's default.
    const target = swapLocaleInPathname(pathname, locale, newLocale);
    // A push is no link click: a settings page with unsaved edits asks here.
    if (!(await confirmLeaveSettings(target))) return;
    router.push(target);
  };

  const fullscreenLabel = isFullscreen
    ? t("admin.preferences.exitFullscreen")
    : t("admin.preferences.enterFullscreen");

  const handleReset = () => {
    resetPreferences();
    // Back to the store's default light/dark, not to a fixed one.
    clearTheme();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-primary transition-colors"
          aria-label={t("admin.preferences.title")}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isRtl ? "left" : "right"}
        showCloseButton={false}
        className={cn(
          "w-[340px] sm:w-[380px] p-0 shadow-2xl bg-background",
          isRtl ? "border-r-0" : "border-l-0",
        )}
      >
        <SheetHeader className="px-5 py-4 flex flex-row items-center justify-between sticky top-0 z-10 bg-background border-b border-border/30">
          <SheetTitle className="text-lg font-bold tracking-tight">
            {t("admin.preferences.title")}
          </SheetTitle>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void toggleFullscreen()}
              className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
              title={fullscreenLabel}
              aria-label={fullscreenLabel}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReset}
              className="relative h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
              title={t("admin.preferences.reset")}
              aria-label={t("admin.preferences.reset")}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            </Button>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-65px)]">
          <div className="p-5 space-y-6">
            <p className="text-xs text-muted-foreground">
              {t("admin.preferences.personalNote")}
            </p>

            {/* Top Grid: Mode, Contrast, RTL, Compact */}
            <div className="grid grid-cols-2 gap-3">
              <SettingCard
                icon={<Moon className="h-5 w-5" strokeWidth={1.5} />}
                label={t("admin.preferences.darkMode")}
                checked={theme === "dark"}
                onCheckedChange={(checked) =>
                  setTheme(checked ? "dark" : "light")
                }
              />
              <SettingCard
                icon={<Contrast className="h-5 w-5" strokeWidth={1.5} />}
                label={t("admin.preferences.contrast")}
                checked={contrast}
                onCheckedChange={setContrast}
              />
              <SettingCard
                icon={<AlignLeft className="h-5 w-5" strokeWidth={1.5} />}
                label={t("admin.preferences.rtl")}
                checked={rtl}
                onCheckedChange={setRtl}
              />
              <SettingCard
                icon={<PanelLeftClose className="h-5 w-5" strokeWidth={1.5} />}
                label={t("admin.preferences.collapsedSidebar")}
                checked={collapsedSidebar}
                onCheckedChange={setCollapsedSidebar}
                hasInfo
              />
            </div>

            {/* Nav Section */}
            <SectionContainer
              label={t("admin.preferences.sidebar")}
              icon={<Info className="h-2.5 w-2.5" />}
            >
              <div className="space-y-5">
                {/* Color */}
                <div className="space-y-3">
                  <span className="text-xs text-muted-foreground font-medium">
                    {t("admin.preferences.sidebarColor")}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <NavColorCard
                      variant="integrate"
                      label={t("admin.preferences.sidebarIntegrate")}
                      isActive={navColor === "integrate"}
                      onClick={() => setNavColor("integrate")}
                    />
                    <NavColorCard
                      variant="apparent"
                      label={t("admin.preferences.sidebarApparent")}
                      isActive={navColor === "apparent"}
                      onClick={() => setNavColor("apparent")}
                    />
                  </div>
                </div>
              </div>
            </SectionContainer>

            {/* Language Section */}
            <SectionContainer label={t("common.language")}>
              <div className="grid grid-cols-3 gap-2">
                {locales.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => void handleLocaleChange(loc)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl transition-all",
                      locale === loc
                        ? "bg-background border border-border shadow-sm"
                        : "bg-transparent border border-transparent hover:bg-muted/50",
                    )}
                  >
                    <FlagIcon countryCode={localeConfig[loc].countryCode} size={18} />
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      {localeConfig[loc].languageCode}
                    </span>
                  </button>
                ))}
              </div>
            </SectionContainer>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
