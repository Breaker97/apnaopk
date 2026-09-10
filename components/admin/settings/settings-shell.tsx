"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LockKeyhole, Menu, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import {
  ADMIN_SETTINGS_GROUPS,
  ADMIN_SETTINGS_SECTIONS,
  getSectionStatus,
  type AdminSettingsSectionId,
} from "@/components/admin/settings/settings-sections";
import {
  AdminSettingsProvider,
  useAdminSettingsContext,
} from "@/components/admin/settings/admin-settings-context";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const SECTION_TO_PATH: Record<AdminSettingsSectionId, string> = {
  general: "general",
  appearance: "appearance",
  marketplace: "marketplace",
  boosting: "boosting",
  pos: "pos",
  twoFactor: "two-factor",
  oauth: "oauth",
  security: "security",
  payment: "payment",
  email: "email",
  notifications: "notifications",
  messaging: "messaging",
  orders: "orders",
  shipping: "shipping",
  seo: "seo",
  social: "social",
  analytics: "analytics",
  maintenance: "maintenance",
  storage: "storage",
  aiAuthoring: "ai",
};

const PATH_TO_SECTION: Record<string, AdminSettingsSectionId> = Object.entries(
  SECTION_TO_PATH,
).reduce(
  (acc, [id, path]) => {
    acc[path] = id as AdminSettingsSectionId;
    return acc;
  },
  {} as Record<string, AdminSettingsSectionId>,
);

const subscribeToClientMount = () => () => {};
const getClientMountSnapshot = () => true;
const getServerMountSnapshot = () => false;

export function SettingsShell({
  locale,
  children,
  initialSettings,
}: {
  locale: string;
  children: ReactNode;
  initialSettings?: unknown;
}) {
  return (
    <AdminSettingsProvider initialSettings={initialSettings}>
      <SettingsShellInner locale={locale}>{children}</SettingsShellInner>
    </AdminSettingsProvider>
  );
}

function SettingsShellInner({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { confirm } = useConfirmation();
  const {
    settings,
    dirtySections,
    hasUnsaved,
    refetch,
    isDemoMode,
    demoModeMessage,
  } = useAdminSettingsContext();
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [mobileQuery, setMobileQuery] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const isMounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientMountSnapshot,
    getServerMountSnapshot,
  );

  const tSafe = useFallbackTranslator(t);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  const settingsBase = `/${locale}/admin/settings`;
  const { activeSegment } = (() => {
    if (!pathname) return { activeSegment: "general" };
    if (pathname === settingsBase || pathname === `${settingsBase}/`) {
      return { activeSegment: "general" };
    }
    const rest = pathname.slice(settingsBase.length + 1);
    const segments = rest.split("/").filter(Boolean);
    return {
      activeSegment: segments[0] || "general",
    };
  })();
  const activeSectionId: AdminSettingsSectionId =
    PATH_TO_SECTION[activeSegment] ?? "general";

  const guardedNavigate = async (href: string) => {
    if (hasUnsaved()) {
      const ok = await confirm({
        title: tSafe("admin.settings.unsavedChanges.title", "Unsaved changes"),
        description: tSafe(
          "admin.settings.unsavedChanges.description",
          "Discard your unsaved changes and switch sections?",
        ),
        confirmText: tSafe("admin.settings.unsavedChanges.confirm", "Discard"),
        cancelText: tSafe("admin.settings.unsavedChanges.cancel", "Stay"),
        type: "danger",
        confirmVariant: "destructive",
      });
      if (!ok) return false;
      await refetch();
    }
    router.push(href);
    return true;
  };

  const handleClose = async () => {
    await guardedNavigate(`/${locale}/admin/dashboard`);
  };

  const handleSectionClick = (
    e: MouseEvent<HTMLAnchorElement>,
    href: string,
    onAfterNavigate?: () => void,
  ) => {
    e.preventDefault();
    void guardedNavigate(href).then((didNavigate) => {
      if (didNavigate) onAfterNavigate?.();
    });
  };

  const filterSections = (query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    return ADMIN_SETTINGS_SECTIONS.filter((s) => {
      const label = tSafe(s.labelKey, s.defaultLabel);
      if (!normalizedQuery) return true;
      return label.toLowerCase().includes(normalizedQuery);
    });
  };

  const filteredSections = filterSections(sidebarQuery);
  const mobileFilteredSections = filterSections(mobileQuery);
  const getIsDirty = (sectionId: AdminSettingsSectionId) => {
    if (sectionId === "marketplace") {
      return dirtySections.has("multiVendorMode");
    }
    if (sectionId === "email") {
      return (
        dirtySections.has("email") || dirtySections.has("emailVerification")
      );
    }
    return dirtySections.has(sectionId);
  };

  const renderSectionList = (
    sections: typeof ADMIN_SETTINGS_SECTIONS,
    onAfterNavigate?: () => void,
  ) => {
    if (sections.length === 0) {
      return (
        <li className="px-2.5 py-4 text-[13px] leading-5 text-muted-foreground">
          {tSafe("admin.settings.noResults", "No settings found")}
        </li>
      );
    }

    return sections.flatMap((section, index) => {
      const Icon = section.icon;
      const label = tSafe(section.labelKey, section.defaultLabel);
      const dirty = getIsDirty(section.id);
      const path = SECTION_TO_PATH[section.id];
      const href = `${settingsBase}/${path}`;
      const isActive = activeSectionId === section.id;
      const unsavedLabel = tSafe("admin.settings.unsaved", "Unsaved");
      // "warning" = enabled but not configured (a gateway with no secret, SMTP
      // without a host, shipping with no zones…) or a state worth a glance
      // (maintenance mode on). `getSectionStatus` existed for exactly this
      // badge but was never rendered; the registry test in
      // tests/payment-gateway-registry.test.ts guards its gateway list.
      const needsAttention =
        !dirty &&
        settings !== null &&
        getSectionStatus(section.id, settings) === "warning";
      const attentionLabel = tSafe(
        "admin.settings.needsAttention",
        "Needs attention",
      );

      // Headers come from group transitions in the (possibly search-filtered)
      // list, so a group is only titled while it has a visible section. The
      // list start already separates the first group, so headers render only
      // between groups — never directly under the search box.
      const startsGroup =
        index > 0 && sections[index - 1].group !== section.group;
      const groupMeta = ADMIN_SETTINGS_GROUPS[section.group];

      const item = (
        <li key={section.id}>
          <a
            href={href}
            onClick={(e) => handleSectionClick(e, href, onAfterNavigate)}
            className={cn(
              "group flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-[13px] leading-4 transition-colors",
              isActive
                ? "bg-primary/10 font-semibold text-primary"
                : "font-medium text-foreground hover:bg-muted",
            )}
          >
            <span className="flex min-w-0 items-center">
              <Icon
                className={cn(
                  "mr-2.5 h-4 w-4 shrink-0 stroke-[2.2px]",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="truncate">{label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {needsAttention && (
                <span
                  className="flex h-4 items-center"
                  role="img"
                  aria-label={attentionLabel}
                  title={attentionLabel}
                >
                  <span
                    className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-500/25"
                    aria-hidden="true"
                  />
                </span>
              )}
              {dirty && (
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-3 transition-colors",
                    isActive
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-muted text-amber-700 group-hover:bg-muted/80 dark:text-amber-300",
                  )}
                  aria-label={unsavedLabel}
                  title={unsavedLabel}
                >
                  {unsavedLabel}
                </span>
              )}
            </span>
          </a>
        </li>
      );

      if (!startsGroup) return [item];
      return [
        <li
          key={`group-${section.group}`}
          className="px-2.5 pt-2.5 text-[10px] font-semibold uppercase leading-3 tracking-wider text-muted-foreground"
        >
          {tSafe(groupMeta.labelKey, groupMeta.defaultLabel)}
        </li>,
        item,
      ];
    });
  };

  const storeName = settings?.general?.storeName?.trim() || DEFAULT_STORE_NAME;
  const storeDomain = settings?.general?.storeDomain || "";
  const storeLogo = settings?.general?.logoUrl;
  const storeFavicon = settings?.general?.faviconUrl;
  const storeSidebarIcon = storeFavicon || storeLogo;
  const storeInitials = storeName
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const shell = (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background text-foreground [scrollbar-color:#777_transparent] dark:[scrollbar-color:#5a5a5a_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#777] dark:[&::-webkit-scrollbar-thumb]:bg-[#5a5a5a] [&::-webkit-scrollbar-track]:bg-transparent">
      <button
        type="button"
        onClick={() => void handleClose()}
        aria-label={tSafe("admin.settings.close", "Close settings")}
        className="fixed right-2 top-2 z-[60] inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="mx-auto flex min-h-full w-full max-w-300 gap-6 px-3 pt-3.5 md:px-0">
        <aside className="sticky top-3.5 hidden h-[calc(100vh-14px)] w-[320px] shrink-0 flex-col overflow-hidden rounded-t-[13px] border border-border bg-card md:flex">
          <div className="flex h-[68px] shrink-0 items-center gap-2.5 border-b border-border px-3">
            <div
              className={cn(
                "relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[10px] font-bold text-white",
                storeSidebarIcon ? "bg-transparent" : "bg-primary",
              )}
            >
              {storeSidebarIcon ? (
                <AppImage
                  src={storeSidebarIcon}
                  alt={storeName}
                  fill
                  sizes="28px"
                  priority
                  className="object-contain"
                />
              ) : (
                <span>{storeInitials || "S"}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-4 text-foreground">
                {storeName}
              </p>
              {storeDomain && (
                <p className="mt-0.5 truncate text-[12px] leading-4 text-muted-foreground">
                  {storeDomain}
                </p>
              )}
            </div>
          </div>

          <div className="px-3 pb-2.5 pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
                placeholder={tSafe("admin.settings.search", "Search")}
                className="h-8 rounded-md border-input bg-background pl-8 text-[13px] leading-4 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/25"
              />
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex flex-col gap-1.5">
              {renderSectionList(filteredSections)}
            </ul>
          </nav>

          <div className="mt-auto flex h-[44px] shrink-0 items-center justify-center border-t border-border px-4">
            <button
              type="button"
              onClick={() => void handleClose()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-semibold leading-4 text-foreground transition-colors hover:bg-muted"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard</span>
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col md:max-w-195">
          <div className="pb-15">
            <div className="mx-auto w-full px-1 md:px-0">
              <div className="sticky top-0 z-40 -mx-1 -mt-1.5 mb-3 flex h-10 items-start bg-background/95 px-1 pt-0 backdrop-blur md:hidden">
                <Sheet
                  open={mobileDrawerOpen}
                  onOpenChange={setMobileDrawerOpen}
                >
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={tSafe(
                        "admin.settings.openMenu",
                        "Open settings menu",
                      )}
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    showCloseButton={false}
                    className="z-[90] w-[min(86vw,340px)] gap-0 border-r border-border bg-background p-0 shadow-2xl"
                  >
                    <SheetHeader className="flex h-[62px] shrink-0 flex-row items-center justify-between gap-3 border-b border-border px-4 py-0">
                      <SheetTitle className="min-w-0 truncate text-[15px] font-semibold leading-5">
                        {tSafe("admin.settings.title", "Settings")}
                      </SheetTitle>
                      <SheetClose asChild>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={tSafe(
                            "admin.settings.closeMenu",
                            "Close settings menu",
                          )}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </SheetClose>
                    </SheetHeader>

                    <div className="border-b border-border px-4 pb-3 pt-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={mobileQuery}
                          onChange={(e) => setMobileQuery(e.target.value)}
                          placeholder={tSafe("admin.settings.search", "Search")}
                          className="h-9 rounded-md border-input bg-background pl-8 text-[13px] leading-4 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/25"
                        />
                      </div>
                    </div>

                    <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <ul className="flex flex-col gap-1.5">
                        {renderSectionList(mobileFilteredSections, () =>
                          setMobileDrawerOpen(false),
                        )}
                      </ul>
                    </nav>

                    <div className="mt-auto border-t border-border px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void handleClose()}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-semibold leading-4 text-foreground transition-colors hover:bg-muted"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5" />
                        <span>Dashboard</span>
                      </button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
              {isDemoMode && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5">Demo mode</p>
                    <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
                      {demoModeMessage}
                    </p>
                  </div>
                </div>
              )}
              {/* Demo mode locks the settings forms read-only, but the
                  storage section owns the Media Library — a browse surface that
                  must stay interactive (open, search, filter, preview) even in
                  demo. That page applies its own read-only treatment to just
                  the storage config form, so exclude it from the blanket lock
                  here. */}
              <fieldset
                disabled={isDemoMode && activeSectionId !== "storage"}
                className={cn(
                  "min-w-0 space-y-4 border-0 p-0",
                  isDemoMode && activeSectionId !== "storage" && "opacity-75",
                )}
              >
                {children}
              </fieldset>
            </div>
          </div>
        </main>
      </div>
    </div>
  );

  if (!isMounted) {
    return null;
  }

  return createPortal(shell, document.body);
}
