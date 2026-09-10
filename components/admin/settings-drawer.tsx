"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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
  RefreshCw,
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
import {
  useAppSettings,
  presetColors,
  type PresetColor,
} from "@/stores/app-settings";
import { DEFAULT_THEME_MODE } from "@/config/branding.config";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/use-fullscreen";
import {
  NavColorCard,
  PresetColorCard,
  SectionContainer,
  SettingCard,
} from "@/components/admin/appearance-settings-ui";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface SettingsDrawerProps {
  locale: Locale;
}

export function SettingsDrawer({ locale }: SettingsDrawerProps) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const { isFullscreen, toggleFullscreen } = useFullscreen({
    onError: () => toast.error("Fullscreen is not available in this browser"),
  });

  const {
    themeMode,
    contrast,
    rtl,
    collapsedSidebar,
    navColor,
    presetColor,
    setThemeMode,
    setContrast,
    setRtl,
    setCollapsedSidebar,
    setNavColor,
    setPresetColor,
    setPrimaryColor,
    setSecondaryColor,
    setAccentColor,
    resetSettings,
    saveToDb,
  } = useAppSettings();

  const isRtl =
    rtl || (localeConfig[locale as Locale]?.direction ?? "ltr") === "rtl";

  // Debounced persist — only triggered by explicit user interaction below, never
  // by hydration or programmatic store writes (which would otherwise feedback-loop).
  //
  // These are store-wide settings behind an admin-only endpoint, and the store
  // applies every change locally before the request is made. A rejected save
  // therefore looks exactly like a successful one until the next page load wipes
  // it, so a refusal has to be said out loud.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveToDb().then((saved) => {
        if (!saved) {
          toast.error(
            tSafe(
              "admin.settings.toasts.appearanceSaveFailed",
              "Appearance settings could not be saved.",
            ),
          );
        }
      });
    }, 700);
  }, [saveToDb, tSafe]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const handleThemeChange = (checked: boolean) => {
    const mode = checked ? "dark" : "light";
    setThemeMode(mode);
    setTheme(mode);
    scheduleSave();
  };

  const handleContrastChange = (checked: boolean) => {
    setContrast(checked);
    scheduleSave();
  };

  const handleRtlChange = (checked: boolean) => {
    setRtl(checked);
    scheduleSave();
  };

  const handleCollapsedSidebarChange = (checked: boolean) => {
    setCollapsedSidebar(checked);
    scheduleSave();
  };

  const handleNavColorChange = (color: "integrate" | "apparent") => {
    setNavColor(color);
    scheduleSave();
  };

  const handlePresetColorChange = (color: PresetColor) => {
    const preset = presetColors[color];
    if (!preset) return;
    // The preset name alone renders nothing — SettingsApplier drives the CSS
    // variables off the primary/secondary/accent triple, so apply that too.
    setPresetColor(color);
    setPrimaryColor(preset.hex);
    setSecondaryColor(preset.secondaryHex);
    setAccentColor(preset.accentHex);
    scheduleSave();
  };

  const handleLocaleChange = (newLocale: Locale) => {
    const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPathname);
  };

  const handleReset = () => {
    resetSettings();
    // Reset lands on light — the app's default — not on the OS preference.
    setTheme(DEFAULT_THEME_MODE);
    scheduleSave();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-primary transition-colors"
          aria-label="Preferences"
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
            Preferences
          </SheetTitle>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void toggleFullscreen()}
              className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
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
              title="Reset to defaults"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            </Button>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-65px)]">
          <div className="p-5 space-y-6">
            {/* Top Grid: Mode, Contrast, RTL, Compact */}
            <div className="grid grid-cols-2 gap-3">
              <SettingCard
                icon={<Moon className="h-5 w-5" strokeWidth={1.5} />}
                label="Mode"
                checked={themeMode === "dark"}
                onCheckedChange={handleThemeChange}
              />
              <SettingCard
                icon={<Contrast className="h-5 w-5" strokeWidth={1.5} />}
                label="Contrast"
                checked={contrast}
                onCheckedChange={handleContrastChange}
              />
              <SettingCard
                icon={<AlignLeft className="h-5 w-5" strokeWidth={1.5} />}
                label="Right to left"
                checked={rtl}
                onCheckedChange={handleRtlChange}
              />
              <SettingCard
                icon={<PanelLeftClose className="h-5 w-5" strokeWidth={1.5} />}
                label="Collapsed sidebar"
                checked={collapsedSidebar}
                onCheckedChange={handleCollapsedSidebarChange}
                hasInfo
              />
            </div>

            {/* Nav Section */}
            <SectionContainer
              label="NAV"
              icon={<Info className="h-2.5 w-2.5" />}
            >
              <div className="space-y-5">
                {/* Color */}
                <div className="space-y-3">
                  <span className="text-xs text-muted-foreground font-medium">
                    Color
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <NavColorCard
                      label="Integrate"
                      isActive={navColor === "integrate"}
                      onClick={() => handleNavColorChange("integrate")}
                    />
                    <NavColorCard
                      label="Apparent"
                      isActive={navColor === "apparent"}
                      onClick={() => handleNavColorChange("apparent")}
                    />
                  </div>
                </div>
              </div>
            </SectionContainer>

            {/* Presets Section */}
            <SectionContainer
              label="PRESETS"
              icon={<RefreshCw className="h-2.5 w-2.5" />}
            >
              <div className="grid grid-cols-3 gap-2.5">
                {(Object.keys(presetColors) as PresetColor[]).map((color) => (
                  <PresetColorCard
                    key={color}
                    color={presetColors[color].primary}
                    isActive={presetColor === color}
                    onClick={() => handlePresetColorChange(color)}
                  />
                ))}
              </div>
            </SectionContainer>

            {/* Language Section */}
            <SectionContainer label="LANGUAGE">
              <div className="grid grid-cols-3 gap-2">
                {locales.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => handleLocaleChange(loc)}
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
