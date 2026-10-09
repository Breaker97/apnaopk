"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import Link from "@/components/language/link";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { cn } from "@/lib/utils";
import {
  ADMIN_SETTINGS_GROUPS,
  ADMIN_SETTINGS_SECTIONS,
  type AdminSettingsSectionId,
} from "./settings-sections";
import { useSettingsNavStatus } from "./settings-nav-status";

/**
 * The dashboard sidebar's menu while a settings page is open: the settings
 * sections take the main menu's place under a search box, the way Cloudflare
 * swaps an account's menu for a domain's. The way back out is the sidebar
 * footer's button, where the Settings button sits on the main menu.
 *
 * Every entry is a plain link. Unsaved edits are the settings provider's to
 * guard (`useUnsavedChangesGuard`) — it holds any link click on the page while
 * there are some.
 */
export function AdminSettingsSidebarNav({
  activeSectionId,
  isApparent,
  isRTL,
  isIconCollapsed,
}: {
  activeSectionId: AdminSettingsSectionId;
  isApparent: boolean;
  isRTL: boolean;
  isIconCollapsed: boolean;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const { isMobile, setOpenMobile } = useSidebar();
  const { dirty, attention } = useSettingsNavStatus();
  const [query, setQuery] = React.useState("");

  // On a phone this menu is a drawer over the page, so picking a section
  // closes it — also when the unsaved-changes prompt holds the pick, which
  // then opens over the page rather than over the drawer.
  const closeDrawer = () => {
    if (isMobile) setOpenMobile(false);
  };

  // The rail hides the search box, so it does not filter by it either — a
  // query typed before collapsing would leave icons missing with no way to
  // see why.
  const normalizedQuery = isIconCollapsed ? "" : query.trim().toLowerCase();
  const groups: Array<{
    id: keyof typeof ADMIN_SETTINGS_GROUPS;
    sections: Array<(typeof ADMIN_SETTINGS_SECTIONS)[number] & { label: string }>;
  }> = [];
  for (const section of ADMIN_SETTINGS_SECTIONS) {
    const label = tSafe(section.labelKey, section.defaultLabel);
    if (normalizedQuery && !label.toLowerCase().includes(normalizedQuery)) {
      continue;
    }
    // Sections of one group are contiguous in the registry.
    const last = groups[groups.length - 1];
    if (last?.id === section.group) last.sections.push({ ...section, label });
    else groups.push({ id: section.group, sections: [{ ...section, label }] });
  }

  const unsavedLabel = tSafe("admin.settings.unsaved", "Unsaved");
  const attentionLabel = tSafe(
    "admin.settings.needsAttention",
    "Needs attention",
  );

  // The collapsed icon rail has no room for labels, so each entry names
  // itself on hover instead.
  const withTooltip = (label: string, button: React.ReactElement) =>
    isIconCollapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={isRTL ? "left" : "right"} sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
    ) : (
      button
    );

  const railButtonClass =
    "group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-md";

  return (
    <>
      {/* The search box takes the slot the way-back button held: the rail has
          no room for it, so the slot goes with it. */}
      <SidebarGroup className="pb-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="relative">
            <Search
              className={cn(
                "pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2",
                isApparent ? "text-white/70" : "text-muted-foreground",
              )}
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tSafe("admin.settings.search", "Search settings")}
              aria-label={tSafe("admin.settings.search", "Search settings")}
              className={cn(
                "h-8 rounded-lg ps-8 text-[13px] shadow-none md:text-[13px]",
                isApparent
                  ? "border-white/25 bg-white/10 text-white placeholder:text-white/60 focus-visible:border-white/50 focus-visible:ring-white/25 dark:bg-white/10"
                  : "bg-background",
              )}
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <div
        role="separator"
        className={cn(
          "mx-2 mb-1 h-px shrink-0 group-data-[collapsible=icon]:hidden",
          isApparent ? "bg-white/20" : "bg-border",
        )}
      />

      {groups.length === 0 ? (
        <p
          className={cn(
            "px-4 py-2 text-[13px] group-data-[collapsible=icon]:hidden",
            isApparent ? "text-white/70" : "text-muted-foreground",
          )}
        >
          {tSafe("admin.settings.noResults", "No settings found")}
        </p>
      ) : (
        groups.map((group) => {
          const groupMeta = ADMIN_SETTINGS_GROUPS[group.id];
          return (
            <SidebarGroup
              key={group.id}
              className="py-0 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-1"
            >
              <SidebarGroupLabel
                className={cn(
                  "mb-0.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] group-data-[collapsible=icon]:hidden",
                  isApparent ? "text-white/60" : "text-muted-foreground/60",
                )}
              >
                {tSafe(groupMeta.labelKey, groupMeta.defaultLabel)}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1">
                  {group.sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = section.id === activeSectionId;
                    const isDirty = dirty.has(section.id);
                    const needsAttention =
                      !isDirty && attention.has(section.id);
                    const state = isDirty
                      ? unsavedLabel
                      : needsAttention
                        ? attentionLabel
                        : null;

                    return (
                      <SidebarMenuItem
                        key={section.id}
                        className="group-data-[collapsible=icon]:w-full"
                      >
                        {withTooltip(
                          state ? `${section.label} · ${state}` : section.label,
                          <SidebarMenuButton
                            asChild
                            size="sm"
                            isActive={isActive}
                            className={cn(
                              "h-auto min-h-9 gap-3 rounded-lg px-3 py-1.5 text-[13px] leading-4 font-semibold transition-colors",
                              railButtonClass,
                              isApparent
                                ? isActive
                                  ? "bg-white/20 text-white hover:bg-white/25"
                                  : "text-white/80 hover:bg-white/10 hover:text-white"
                                : isActive
                                  ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20"
                                  : "text-foreground/70 hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            <Link
                              prefetch={false}
                              href={`/admin/settings/${section.path}`}
                              onClick={closeDrawer}
                              aria-current={isActive ? "page" : undefined}
                            >
                              <span className="relative inline-flex shrink-0">
                                <Icon className="size-4.5 shrink-0 stroke-2" />
                                {state && (
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "absolute -end-1 -top-1 hidden size-2 rounded-full ring-2 group-data-[collapsible=icon]:block",
                                      isApparent
                                        ? "bg-amber-300 ring-sidebar"
                                        : "bg-amber-500 ring-sidebar",
                                    )}
                                  />
                                )}
                              </span>
                              <span className="line-clamp-2 min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                                {section.label}
                              </span>
                              {needsAttention && (
                                <span
                                  role="img"
                                  aria-label={attentionLabel}
                                  title={attentionLabel}
                                  className={cn(
                                    "size-2 shrink-0 rounded-full group-data-[collapsible=icon]:hidden",
                                    isApparent
                                      ? "bg-amber-300 ring-2 ring-amber-300/30"
                                      : "bg-amber-500 ring-2 ring-amber-500/25",
                                  )}
                                />
                              )}
                              {isDirty && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-3 group-data-[collapsible=icon]:hidden",
                                    isApparent
                                      ? "border-white/30 bg-white/15 text-white"
                                      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                  )}
                                >
                                  {unsavedLabel}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>,
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })
      )}
    </>
  );
}
