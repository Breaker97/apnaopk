"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  Check,
  ExternalLink,
  ImageIcon,
  LayoutPanelTop,
  Loader2,
  Megaphone,
  Palette,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaUploader } from "@/components/ui/media-uploader";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { VendorAnnouncement } from "@/components/store/vendor-announcement";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  accentForeground,
  isInternalLink,
  normalizeAccentColor,
  VENDOR_ANNOUNCEMENT_TEXT_MAX,
  VENDOR_BANNER_SIZES,
  VENDOR_DEFAULT_SORTS,
  VENDOR_SEO_DESCRIPTION_MAX,
  VENDOR_SEO_TITLE_MAX,
  type VendorBannerSize,
  type VendorDefaultSort,
  type VendorPageAnnouncement,
  type VendorPageSettings,
} from "@/lib/vendors/vendor-store-page";

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

type SettingsTab = "store" | "announcement" | "seo";
type NoticeStatus = "off" | "scheduled" | "live" | "ended";

/** ISO → the `datetime-local` input's local "YYYY-MM-DDTHH:mm". */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The `datetime-local` input's local time → ISO; "" stays open-ended. */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Where the announcement stands right now — the badge on its tab and card. */
function noticeStatus(
  announcement: VendorPageAnnouncement,
  now: Date = new Date(),
): NoticeStatus {
  if (!announcement.text.trim()) return "off";
  const time = now.getTime();
  if (announcement.startsAt && time < Date.parse(announcement.startsAt)) {
    return "scheduled";
  }
  if (announcement.endsAt && time >= Date.parse(announcement.endsAt)) {
    return "ended";
  }
  return "live";
}

/**
 * The vendor landing-page editor's own page-bar controls: a link to the live
 * store, and the page settings — how the store page opens and looks, the
 * Home tab's announcement, and the search preview — which apply as soon as
 * they are saved (they are not part of the draft).
 */
export function VendorLandingPageActions({
  storeUrl,
  initialSettings,
  canEdit,
  storeName = "",
  storeDescription = "",
  storeImage = "",
}: {
  /** The live /vendors/<slug> URL; null while the store is not public. */
  storeUrl: string | null;
  initialSettings: VendorPageSettings;
  canEdit: boolean;
  /** The store's own name, description and artwork: the search preview's fallbacks. */
  storeName?: string;
  storeDescription?: string;
  storeImage?: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("store");
  const [saved, setSaved] = useState(initialSettings);
  const [draft, setDraft] = useState(initialSettings);
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<VendorPageSettings>) =>
    setDraft((current) => ({ ...current, ...next }));
  const patchAnnouncement = (next: Partial<VendorPageAnnouncement>) =>
    setDraft((current) => ({
      ...current,
      announcement: { ...current.announcement, ...next },
    }));
  const patchSeo = (next: Partial<VendorPageSettings["seo"]>) =>
    setDraft((current) => ({ ...current, seo: { ...current.seo, ...next } }));

  const accentValid =
    draft.accentColor === "" || normalizeAccentColor(draft.accentColor) !== "";
  const accentPreview = normalizeAccentColor(draft.accentColor);
  const noticeColorValid =
    draft.announcement.color === "" ||
    normalizeAccentColor(draft.announcement.color) !== "";
  const noticeLinkValid = isInternalLink(draft.announcement.link.trim());
  const noticeDatesValid =
    !draft.announcement.startsAt ||
    !draft.announcement.endsAt ||
    draft.announcement.endsAt > draft.announcement.startsAt;
  const storeTabValid = accentValid;
  const noticeTabValid = noticeColorValid && noticeLinkValid && noticeDatesValid;
  const valid = storeTabValid && noticeTabValid;
  const status = noticeStatus(draft.announcement);

  const openDialog = () => {
    setDraft(saved);
    setTab("store");
    setOpen(true);
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const result = await apiClient.put<{ settings: VendorPageSettings }>(
        "/api/vendor/store-page/settings",
        {
          ...draft,
          accentColor: normalizeAccentColor(draft.accentColor),
          announcement: {
            ...draft.announcement,
            link: draft.announcement.link.trim(),
            color: normalizeAccentColor(draft.announcement.color),
          },
        },
      );
      setSaved(result.settings);
      setOpen(false);
      toast.success(
        tSafe("vendor.landingPage.settings.saved", "Page settings saved"),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const sortLabels: Record<VendorDefaultSort, string> = {
    popular: tSafe("productsPage.filters.sortOptions.mostPopular", "Most popular"),
    createdAt: tSafe("productsPage.filters.sortOptions.newest", "Newest"),
    rating: tSafe("productsPage.filters.sortOptions.bestRating", "Best rating"),
    "price-asc": tSafe("productsPage.filters.sortOptions.priceLowHigh", "Price: low to high"),
    "price-desc": tSafe("productsPage.filters.sortOptions.priceHighLow", "Price: high to low"),
  };
  const bannerLabels: Record<VendorBannerSize, string> = {
    compact: tSafe("vendor.landingPage.settings.bannerCompact", "Compact"),
    standard: tSafe("vendor.landingPage.settings.bannerStandard", "Standard"),
    tall: tSafe("vendor.landingPage.settings.bannerTall", "Tall"),
  };
  const statusLabels: Record<NoticeStatus, string> = {
    off: tSafe("vendor.landingPage.settings.statusOff", "Off"),
    scheduled: tSafe("vendor.landingPage.settings.statusScheduled", "Scheduled"),
    live: tSafe("vendor.landingPage.settings.statusLive", "Live"),
    ended: tSafe("vendor.landingPage.settings.statusEnded", "Ended"),
  };
  const invalidColorLabel = tSafe(
    "vendor.landingPage.settings.accentInvalid",
    "Enter a colour like #2065d1.",
  );

  // The search preview reads exactly what the page's metadata will use.
  const previewTitle = draft.seo.title || storeName;
  const previewDescription =
    draft.seo.description ||
    storeDescription ||
    (storeName ? `Shop products from ${storeName}.` : "");
  const previewImage = draft.seo.image || storeImage;
  const previewHost =
    typeof window === "undefined" ? "" : window.location.host;

  return (
    <>
      {storeUrl ? (
        <Button asChild type="button" variant="outline" className="gap-1.5">
          <a href={storeUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            {tSafe("vendor.landingPage.viewStore", "View store")}
          </a>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="gap-1.5"
        onClick={openDialog}
      >
        <SlidersHorizontal className="h-4 w-4" />
        {tSafe("vendor.landingPage.settings.open", "Page settings")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SettingsTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            {/* Header: what this is, then the three areas it covers. */}
            <div className="space-y-4 border-b px-6 pt-6 pb-4">
              <DialogHeader className="gap-1.5 pe-8">
                <DialogTitle className="text-lg font-semibold tracking-tight">
                  {tSafe("vendor.landingPage.settings.title", "Page settings")}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed">
                  {tSafe(
                    "vendor.landingPage.settings.subtitle",
                    "How your store page opens, looks and shows up in search.",
                  )}
                </DialogDescription>
              </DialogHeader>
              <TabsList className="h-10 w-full">
                <SettingsTabTrigger
                  value="store"
                  icon={LayoutPanelTop}
                  label={tSafe("vendor.landingPage.settings.storeGroup", "Store page")}
                  invalid={!storeTabValid}
                />
                <SettingsTabTrigger
                  value="announcement"
                  icon={Megaphone}
                  label={tSafe(
                    "vendor.landingPage.settings.announcementGroup",
                    "Announcement",
                  )}
                  invalid={!noticeTabValid}
                  live={status === "live"}
                />
                <SettingsTabTrigger
                  value="seo"
                  icon={Search}
                  label={tSafe("vendor.landingPage.settings.seoGroup", "Search & sharing")}
                />
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 px-6 py-5">
              {/* ---- How the store page opens and looks ------------------ */}
              <TabsContent value="store" className="space-y-4">
                <SettingsCard
                  icon={LayoutPanelTop}
                  title={tSafe("vendor.landingPage.settings.navigationGroup", "Tabs")}
                  description={tSafe(
                    "vendor.landingPage.settings.navigationHint",
                    "Which tab your store opens on, and which tabs shoppers see.",
                  )}
                >
                  <SettingRow
                    label={tSafe("vendor.landingPage.settings.defaultTab", "Opens on")}
                    hint={tSafe(
                      "vendor.landingPage.settings.defaultTabHint",
                      "The tab your store link opens on. Home shows only once your landing page is published.",
                    )}
                    control={
                      <SegmentedControl
                        label={tSafe("vendor.landingPage.settings.defaultTab", "Opens on")}
                        value={draft.defaultTab}
                        onChange={(value) => patch({ defaultTab: value })}
                        disabled={!canEdit}
                        options={[
                          { value: "home", label: tSafe("vendor.storefront.tabHome", "Home") },
                          { value: "products", label: tSafe("common.products", "Products") },
                        ]}
                      />
                    }
                  />
                  <SettingRow
                    label={tSafe("vendor.landingPage.settings.showAbout", "Show the About tab")}
                    control={
                      <Switch
                        checked={!draft.hideAboutTab}
                        onCheckedChange={(checked) => patch({ hideAboutTab: !checked })}
                        disabled={!canEdit}
                        aria-label={tSafe(
                          "vendor.landingPage.settings.showAbout",
                          "Show the About tab",
                        )}
                      />
                    }
                  />
                  <SettingRow
                    label={tSafe(
                      "vendor.landingPage.settings.showShipping",
                      "Show the Shipping & returns tab",
                    )}
                    hint={tSafe(
                      "vendor.landingPage.settings.tabsHint",
                      "Products and Reviews always show.",
                    )}
                    control={
                      <Switch
                        checked={!draft.hideShippingTab}
                        onCheckedChange={(checked) => patch({ hideShippingTab: !checked })}
                        disabled={!canEdit}
                        aria-label={tSafe(
                          "vendor.landingPage.settings.showShipping",
                          "Show the Shipping & returns tab",
                        )}
                      />
                    }
                  />
                </SettingsCard>

                <SettingsCard
                  icon={Palette}
                  title={tSafe("vendor.landingPage.settings.appearanceGroup", "Appearance")}
                  description={tSafe(
                    "vendor.landingPage.settings.appearanceHint",
                    "The top of your store page and the colour of its buttons and links.",
                  )}
                >
                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.bannerSize", "Banner size")}
                    action={
                      <Link
                        href="/vendor/settings"
                        target="_blank"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        {tSafe(
                          "vendor.landingPage.settings.changeBanner",
                          "Change the banner or logo in Settings",
                        )}
                      </Link>
                    }
                  >
                    <div
                      role="radiogroup"
                      aria-label={tSafe("vendor.landingPage.settings.bannerSize", "Banner size")}
                      className="grid grid-cols-3 gap-2.5"
                    >
                      {VENDOR_BANNER_SIZES.map((size) => {
                        const selected = draft.bannerSize === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!canEdit}
                            onClick={() => patch({ bannerSize: size })}
                            className={cn(
                              "relative flex flex-col gap-2 rounded-lg border bg-background p-2.5 text-start transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                              selected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "border-border hover:border-foreground/30",
                            )}
                          >
                            <BannerMock size={size} />
                            <span
                              className={cn(
                                "text-sm font-medium",
                                selected ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {bannerLabels[size]}
                            </span>
                            {selected ? (
                              <span className="absolute end-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-2.5 w-2.5" strokeWidth={3} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </FieldBlock>

                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.accent", "Accent colour")}
                    htmlFor="vendor-accent-color"
                    hint={tSafe(
                      "vendor.landingPage.settings.accentHint",
                      "Buttons and links on your store page. Leave empty to use the marketplace colour.",
                    )}
                    error={accentValid ? undefined : invalidColorLabel}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <ColorInput
                        id="vendor-accent-color"
                        label={tSafe("vendor.landingPage.settings.accent", "Accent colour")}
                        value={draft.accentColor}
                        onChange={(value) => patch({ accentColor: value })}
                        placeholder={tSafe(
                          "vendor.landingPage.settings.marketplaceColour",
                          "Marketplace colour",
                        )}
                        clearLabel={tSafe(
                          "vendor.landingPage.settings.useTheme",
                          "Use marketplace colour",
                        )}
                        valid={accentValid}
                        disabled={!canEdit}
                      />
                      {accentValid && accentPreview ? (
                        <span
                          className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium shadow-xs"
                          style={{
                            backgroundColor: accentPreview,
                            color: accentForeground(accentPreview),
                          }}
                        >
                          {tSafe("vendor.landingPage.settings.accentSample", "Sample button")}
                        </span>
                      ) : null}
                    </div>
                  </FieldBlock>
                </SettingsCard>

                <SettingsCard
                  icon={ShoppingBag}
                  title={tSafe("vendor.landingPage.settings.productsGroup", "Products tab")}
                  description={tSafe(
                    "vendor.landingPage.settings.productsHint",
                    "How your product list is ordered and what shows under it.",
                  )}
                >
                  <SettingRow
                    label={tSafe("vendor.landingPage.settings.defaultSort", "Product order")}
                    htmlFor="vendor-default-sort"
                    hint={tSafe(
                      "vendor.landingPage.settings.defaultSortHint",
                      "How your Products tab is ordered until a shopper picks another order.",
                    )}
                    control={
                      <NativeSelect
                        id="vendor-default-sort"
                        value={draft.defaultSort}
                        onChange={(event) =>
                          patch({ defaultSort: event.target.value as VendorDefaultSort })
                        }
                        disabled={!canEdit}
                        className="w-48 bg-background"
                      >
                        {VENDOR_DEFAULT_SORTS.map((sort) => (
                          <option key={sort} value={sort}>
                            {sortLabels[sort]}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                  <SettingRow
                    label={tSafe(
                      "vendor.landingPage.settings.similar",
                      "Show similar products from other stores",
                    )}
                    hint={tSafe(
                      "vendor.landingPage.settings.similarHint",
                      "A row under your product list that suggests comparable items from other sellers.",
                    )}
                    control={
                      <Switch
                        checked={draft.showSimilarProducts}
                        onCheckedChange={(checked) => patch({ showSimilarProducts: checked })}
                        disabled={!canEdit}
                        aria-label={tSafe(
                          "vendor.landingPage.settings.similar",
                          "Show similar products from other stores",
                        )}
                      />
                    }
                  />
                </SettingsCard>
              </TabsContent>

              {/* ---- The Home tab's announcement ------------------------- */}
              <TabsContent value="announcement" className="space-y-4">
                <SettingsCard
                  icon={Megaphone}
                  title={tSafe(
                    "vendor.landingPage.settings.announcementGroup",
                    "Announcement",
                  )}
                  description={tSafe(
                    "vendor.landingPage.settings.announcementHint",
                    "A short notice at the top of your Home tab, like a sale. Leave the text empty to show none.",
                  )}
                  badge={<NoticeBadge status={status} label={statusLabels[status]} />}
                >
                  <FieldBlock label={tSafe("vendor.landingPage.settings.preview", "Preview")}>
                    {draft.announcement.text.trim() ? (
                      // A picture of the strip, not a working link.
                      <div className="pointer-events-none select-none" aria-hidden>
                        <VendorAnnouncement
                          announcement={{
                            ...draft.announcement,
                            color:
                              normalizeAccentColor(draft.announcement.color) ||
                              accentPreview,
                          }}
                        />
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed bg-background px-4 py-3 text-center text-sm text-muted-foreground">
                        {tSafe(
                          "vendor.landingPage.settings.announcementEmpty",
                          "Write a message below to see your announcement here.",
                        )}
                      </p>
                    )}
                  </FieldBlock>

                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.announcementText", "Text")}
                    htmlFor="vendor-notice-text"
                    counter={
                      <CharCount
                        value={draft.announcement.text.length}
                        max={VENDOR_ANNOUNCEMENT_TEXT_MAX}
                      />
                    }
                  >
                    <Input
                      id="vendor-notice-text"
                      value={draft.announcement.text}
                      onChange={(event) => patchAnnouncement({ text: event.target.value })}
                      maxLength={VENDOR_ANNOUNCEMENT_TEXT_MAX}
                      placeholder={tSafe(
                        "vendor.landingPage.settings.announcementPlaceholder",
                        "Eid sale — 20% off everything this week",
                      )}
                      disabled={!canEdit}
                      className="bg-background"
                    />
                  </FieldBlock>

                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <FieldBlock
                      label={tSafe("vendor.landingPage.settings.announcementLink", "Link")}
                      optional={tSafe("vendor.landingPage.settings.optional", "Optional")}
                      htmlFor="vendor-notice-link"
                      error={
                        noticeLinkValid
                          ? undefined
                          : tSafe(
                              "vendor.landingPage.settings.announcementLinkInvalid",
                              "Links must point to a page on this store, starting with /",
                            )
                      }
                    >
                      <Input
                        id="vendor-notice-link"
                        value={draft.announcement.link}
                        onChange={(event) => patchAnnouncement({ link: event.target.value })}
                        placeholder="/vendors/your-store?tab=products"
                        aria-invalid={!noticeLinkValid}
                        disabled={!canEdit}
                        className="bg-background font-mono text-[13px] placeholder:font-sans"
                      />
                    </FieldBlock>
                    <FieldBlock
                      label={tSafe(
                        "vendor.landingPage.settings.announcementColor",
                        "Background",
                      )}
                      htmlFor="vendor-notice-color"
                      error={noticeColorValid ? undefined : invalidColorLabel}
                    >
                      <ColorInput
                        id="vendor-notice-color"
                        label={tSafe(
                          "vendor.landingPage.settings.announcementColor",
                          "Background",
                        )}
                        value={draft.announcement.color}
                        onChange={(value) => patchAnnouncement({ color: value })}
                        placeholder={tSafe(
                          "vendor.landingPage.settings.accentColourFallback",
                          "Accent colour",
                        )}
                        clearLabel={tSafe(
                          "vendor.landingPage.settings.useAccent",
                          "Use the accent colour",
                        )}
                        valid={noticeColorValid}
                        disabled={!canEdit}
                      />
                    </FieldBlock>
                  </div>
                </SettingsCard>

                <SettingsCard
                  icon={CalendarClock}
                  title={tSafe("vendor.landingPage.settings.scheduleGroup", "Schedule")}
                  description={tSafe(
                    "vendor.landingPage.settings.scheduleHint",
                    "Optional. Without dates the announcement shows until you clear its text.",
                  )}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldBlock
                      label={tSafe("vendor.landingPage.settings.announcementStart", "Starts")}
                      htmlFor="vendor-notice-start"
                    >
                      <Input
                        id="vendor-notice-start"
                        type="datetime-local"
                        value={toLocalInput(draft.announcement.startsAt)}
                        onChange={(event) =>
                          patchAnnouncement({ startsAt: fromLocalInput(event.target.value) })
                        }
                        disabled={!canEdit}
                        className="bg-background"
                      />
                    </FieldBlock>
                    <FieldBlock
                      label={tSafe("vendor.landingPage.settings.announcementEnd", "Ends")}
                      htmlFor="vendor-notice-end"
                      error={
                        noticeDatesValid
                          ? undefined
                          : tSafe(
                              "vendor.landingPage.settings.announcementDatesInvalid",
                              "The end must come after the start.",
                            )
                      }
                    >
                      <Input
                        id="vendor-notice-end"
                        type="datetime-local"
                        value={toLocalInput(draft.announcement.endsAt)}
                        onChange={(event) =>
                          patchAnnouncement({ endsAt: fromLocalInput(event.target.value) })
                        }
                        aria-invalid={!noticeDatesValid}
                        disabled={!canEdit}
                        className="bg-background"
                      />
                    </FieldBlock>
                  </div>
                </SettingsCard>
              </TabsContent>

              {/* ---- What search results and shared links show ----------- */}
              <TabsContent value="seo" className="space-y-4">
                <SettingsCard
                  icon={Search}
                  title={tSafe("vendor.landingPage.settings.seoGroup", "Search & sharing")}
                  description={tSafe(
                    "vendor.landingPage.settings.seoHint",
                    "What Google and shared links show for your store. Leave a field empty to use your store name, description and banner.",
                  )}
                >
                  <FieldBlock label={tSafe("vendor.landingPage.settings.preview", "Preview")}>
                    <div className="flex gap-3 rounded-lg border bg-background p-3">
                      <div className="relative aspect-[1200/630] w-28 shrink-0 overflow-hidden rounded-md bg-muted sm:w-36">
                        {previewImage ? (
                          <AppImage
                            src={previewImage}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="144px"
                          />
                        ) : (
                          <ImageIcon
                            className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-xs text-muted-foreground">
                          {previewHost}
                          {storeUrl ?? ""}
                        </p>
                        <p className="line-clamp-1 text-[15px] font-medium leading-snug text-blue-700 dark:text-blue-400">
                          {previewTitle ||
                            tSafe("vendor.landingPage.settings.seoTitle", "Title")}
                        </p>
                        <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                          {previewDescription}
                        </p>
                      </div>
                    </div>
                  </FieldBlock>

                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.seoTitle", "Title")}
                    htmlFor="vendor-seo-title"
                    counter={
                      <CharCount value={draft.seo.title.length} max={VENDOR_SEO_TITLE_MAX} />
                    }
                  >
                    <Input
                      id="vendor-seo-title"
                      value={draft.seo.title}
                      onChange={(event) => patchSeo({ title: event.target.value })}
                      maxLength={VENDOR_SEO_TITLE_MAX}
                      placeholder={storeName}
                      disabled={!canEdit}
                      className="bg-background"
                    />
                  </FieldBlock>

                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.seoDescription", "Description")}
                    htmlFor="vendor-seo-description"
                    counter={
                      <CharCount
                        value={draft.seo.description.length}
                        max={VENDOR_SEO_DESCRIPTION_MAX}
                      />
                    }
                  >
                    <Textarea
                      id="vendor-seo-description"
                      value={draft.seo.description}
                      onChange={(event) => patchSeo({ description: event.target.value })}
                      maxLength={VENDOR_SEO_DESCRIPTION_MAX}
                      placeholder={storeDescription}
                      rows={3}
                      disabled={!canEdit}
                      className="resize-none bg-background"
                    />
                  </FieldBlock>

                  <FieldBlock
                    label={tSafe("vendor.landingPage.settings.seoImage", "Share image")}
                    hint={tSafe(
                      "vendor.landingPage.settings.seoImageSize",
                      "Recommended size: 1200 x 630 px",
                    )}
                  >
                    <MediaUploader
                      value={
                        draft.seo.image
                          ? [
                              {
                                _id: "vendor-share-image",
                                url: draft.seo.image,
                                type: "image",
                                mimeType: "image/*",
                                alt: "",
                                position: 0,
                              },
                            ]
                          : []
                      }
                      onChange={(items) =>
                        patchSeo({
                          image: items.find((item) => item.type === "image")?.url || "",
                        })
                      }
                      maxFiles={1}
                      acceptTypes={["image"]}
                      accept={IMAGE_ACCEPT}
                      allowedFileExtensions={IMAGE_EXTENSIONS}
                      disabled={!canEdit}
                      uploadTitle={tSafe(
                        "vendor.landingPage.settings.seoImageUpload",
                        "Drag and drop an image, or click to browse",
                      )}
                      uploadZoneClassName="bg-background"
                      mediaGridClassName="grid-cols-1 md:grid-cols-1 max-w-64"
                      previewAspectRatio="1200 / 630"
                      showCoverBadge={false}
                      coverHint={false}
                    />
                  </FieldBlock>
                </SettingsCard>
              </TabsContent>
            </div>

            {/* Footer: when this applies, and the two ways out. */}
            <div className="flex flex-col-reverse gap-3 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-snug text-muted-foreground">
                {tSafe(
                  "vendor.landingPage.settings.description",
                  "These apply to your store page as soon as you save. They are not part of the draft.",
                )}
              </p>
              <div className="flex shrink-0 justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {tSafe("common.cancel", "Cancel")}
                </Button>
                {canEdit ? (
                  <Button
                    type="button"
                    onClick={save}
                    disabled={saving || !valid}
                    className="min-w-24 gap-1.5"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {tSafe("common.save", "Save")}
                  </Button>
                ) : null}
              </div>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

type IconComponent = ComponentType<{ className?: string }>;

/** A tab in the dialog's header; a red dot marks one with a field to fix. */
function SettingsTabTrigger({
  value,
  icon: Icon,
  label,
  invalid = false,
  live = false,
}: {
  value: SettingsTab;
  icon: IconComponent;
  label: string;
  invalid?: boolean;
  live?: boolean;
}) {
  return (
    <TabsTrigger value={value} className="relative min-w-0 gap-1.5 px-2 text-[13px] sm:px-3">
      <Icon className="hidden h-4 w-4 sm:block" />
      <span className="truncate">{label}</span>
      {invalid ? (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
      ) : live ? (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      ) : null}
    </TabsTrigger>
  );
}

/**
 * One group of settings: an icon, a title that names the group, a line on
 * what it decides, then its rows — the hierarchy the dialog reads by.
 */
function SettingsCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: IconComponent;
  title: string;
  description?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <header className="flex items-start gap-3 border-b px-4 py-3.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">
              {title}
            </h3>
            {badge}
          </div>
          {description ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </header>
      <div className="space-y-5 px-4 py-4 [&>[data-setting-row]+[data-setting-row]]:border-t [&>[data-setting-row]+[data-setting-row]]:pt-4">
        {children}
      </div>
    </section>
  );
}

/** A setting with its control on the right: switches, short pickers. */
function SettingRow({
  label,
  hint,
  htmlFor,
  control,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  control: ReactNode;
}) {
  return (
    <div
      data-setting-row
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {hint ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** A setting whose control takes the full width under its label. */
function FieldBlock({
  label,
  htmlFor,
  hint,
  error,
  optional,
  counter,
  action,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  optional?: string;
  counter?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {optional ? (
            <span className="ms-1.5 text-xs font-normal text-muted-foreground">
              {optional}
            </span>
          ) : null}
        </Label>
        {counter ?? action}
      </div>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** "12 / 160", turning amber in the last tenth so the cap is no surprise. */
function CharCount({ value, max }: { value: number; max: number }) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        value >= max * 0.9
          ? "font-medium text-amber-600 dark:text-amber-400"
          : "text-muted-foreground",
      )}
    >
      {value} / {max}
    </span>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-muted p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-w-20 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A swatch and a hex field in one control. Empty, the swatch is striped and
 * the field names what is used instead — never a colour that reads as set.
 */
function ColorInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  clearLabel,
  valid,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  valid: boolean;
  disabled?: boolean;
}) {
  const color = normalizeAccentColor(value);
  return (
    <div
      className={cn(
        "flex h-9 w-56 items-center gap-2 rounded-md border bg-background ps-1.5 pe-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        !valid && "border-destructive focus-within:ring-destructive/20",
        disabled && "opacity-60",
      )}
    >
      <span
        className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md border border-black/10 dark:border-white/15"
        style={
          color
            ? { backgroundColor: color }
            : {
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--muted) 0 4px, var(--background) 4px 8px)",
              }
        }
      >
        <input
          type="color"
          aria-label={label}
          value={color || "#2065d1"}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder={placeholder}
        maxLength={7}
        disabled={disabled}
        aria-invalid={!valid}
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      {value && !disabled ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={clearLabel}
          title={clearLabel}
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** A sketch of the store header at each banner height. */
function BannerMock({ size }: { size: VendorBannerSize }) {
  return (
    <span
      aria-hidden
      className="block w-full rounded-md border border-border/70 bg-muted/40 p-1.5"
    >
      <span
        className={cn(
          "block w-full rounded-sm bg-linear-to-r from-primary/35 to-primary/15",
          size === "compact" ? "h-3" : size === "standard" ? "h-5" : "h-8",
        )}
      />
      <span className="mt-1.5 flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-foreground/25" />
        <span className="block h-1.5 w-2/3 rounded-full bg-foreground/20" />
      </span>
      <span className="mt-1 block h-1 w-1/2 rounded-full bg-foreground/10" />
    </span>
  );
}

function NoticeBadge({ status, label }: { status: NoticeStatus; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        status === "live" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "scheduled" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        (status === "off" || status === "ended") && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "live"
            ? "bg-emerald-500"
            : status === "scheduled"
              ? "bg-amber-500"
              : "bg-muted-foreground/50",
        )}
      />
      {label}
    </Badge>
  );
}
