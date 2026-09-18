"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Redo2,
  Facebook,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Moon,
  Phone,
  Plus,
  Store,
  Sun,
  Trash2,
  Twitter,
  Undo2,
  Youtube,
} from "lucide-react";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { ImageUploadField } from "@/components/admin/settings/fields/image-upload-field";
import { AppImage } from "@/components/ui/app-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumberInput } from "@/components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import {
  FOOTER_LOGO_THEMES,
  getDefaultFooterSettings,
  normalizeFooterSettings,
  resolveFooterContactDetails,
  resolveFooterLogoUrl,
  resolveFooterLogoWidths,
  type FooterColorScheme,
  type FooterContactDetails,
  type FooterSettings,
  type FooterSource,
} from "@/lib/site-config/footer-config";
import {
  headerLogoWidths,
  normalizeHeaderSettings,
  type LogoWidths,
} from "@/lib/site-config/header-config";
import {
  MAX_HEADER_LOGO_SIZE,
  MIN_HEADER_LOGO_SIZE,
} from "@/lib/site-config/header-layout";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/providers/app-settings-provider";
import { ColorField, FieldRow, SwitchRow } from "@/components/admin/online-store/builder-fields";
import { FooterBuilderSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import { setNestedValue } from "@/components/admin/online-store/set-nested-value";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface FooterBuilderProps {
  locale: string;
}

type SettingsPayload = {
  success?: boolean;
  data?: {
    footer?: unknown;
    header?: unknown;
    general?: {
      storeName?: unknown;
      storeDescription?: unknown;
      storeEmail?: unknown;
      storePhone?: unknown;
      storeAddress?: unknown;
      logoUrl?: unknown;
      darkModeLogoUrl?: unknown;
    };
    social?: Record<string, unknown>;
  };
};

const socialFields = [
  { key: "facebookUrl", label: "Facebook" },
  { key: "twitterUrl", label: "Twitter / X" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "youtubeUrl", label: "YouTube" },
  { key: "linkedinUrl", label: "LinkedIn" },
  { key: "tiktokUrl", label: "TikTok" },
] as const;

const HISTORY_LIMIT = 100;

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getStoreContact(payload: SettingsPayload): FooterContactDetails {
  return {
    phone: getString(payload.data?.general?.storePhone),
    email: getString(payload.data?.general?.storeEmail),
    address: getString(payload.data?.general?.storeAddress),
  };
}

/** The store's light/dark logo pair, as Branding saved it. */
interface StoreLogos {
  storeLogoUrl: string;
  storeDarkLogoUrl: string;
}

function getStoreLogos(payload: SettingsPayload): StoreLogos {
  return {
    storeLogoUrl: getString(payload.data?.general?.logoUrl).trim(),
    storeDarkLogoUrl: getString(payload.data?.general?.darkModeLogoUrl).trim(),
  };
}

function normalizeInitialFooter(payload: SettingsPayload): FooterSettings {
  const footer = normalizeFooterSettings(payload.data?.footer);
  const general = payload.data?.general;
  const social = payload.data?.social;

  // The logo is deliberately NOT pre-filled from the store's: a copy saved
  // into the footer stops following Branding — that copy is what kept the
  // light logo in the footer in dark mode.
  if (!footer.brand.description && getString(general?.storeDescription)) {
    footer.brand.description = getString(general?.storeDescription);
  }
  for (const field of socialFields) {
    if (!footer.social.links[field.key] && getString(social?.[field.key])) {
      footer.social.links[field.key] = getString(social?.[field.key]);
    }
  }

  return footer;
}

function cloneFooter(value: FooterSettings): FooterSettings {
  return structuredClone(value);
}

function areFootersEqual(a: FooterSettings, b: FooterSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FooterBuilder({ locale }: FooterBuilderProps) {
  const t = useTranslations("admin.footerCms");
  // New-key guard: these labels post-date several locale files.
  const tf = useFallbackTranslator(t);
  // Reusable menus for the column source selector (Navigation's trees).
  const [availableMenus, setAvailableMenus] = useState<
    { handle: string; name: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/menus?page=1&limit=100");
        const json = await res.json().catch(() => null);
        if (!active || !json?.success) return;
        const rows = (json.data?.data ?? []) as {
          handle?: string;
          name?: string;
        }[];
        setAvailableMenus(
          rows.flatMap((row) =>
            row.handle && row.name
              ? [{ handle: row.handle, name: row.name }]
              : [],
          ),
        );
      } catch {
        // The selector simply offers no menus; custom links keep working.
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const { storeName } = useAppSettings();
  const [footer, setFooter] = useState<FooterSettings>(getDefaultFooterSettings());
  const [storeContact, setStoreContact] = useState<FooterContactDetails>({
    phone: "",
    email: "",
    address: "",
  });
  const [storeLogos, setStoreLogos] = useState<StoreLogos>({
    storeLogoUrl: "",
    storeDarkLogoUrl: "",
  });
  // What "same size as the header" resolves to, read from the saved header.
  const [headerLogo, setHeaderLogo] = useState<LogoWidths>(() =>
    headerLogoWidths(normalizeHeaderSettings(undefined)),
  );
  const footerRef = useRef<FooterSettings>(footer);
  const [initialFooter, setInitialFooter] = useState<FooterSettings>(
    getDefaultFooterSettings(),
  );
  const [undoStack, setUndoStack] = useState<FooterSettings[]>([]);
  const [redoStack, setRedoStack] = useState<FooterSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsPayload;

        if (!response.ok || payload.success !== true) {
          throw new Error(t("toast.loadSettingsFailed"));
        }

        const parsed = normalizeInitialFooter(payload);
        setStoreContact(getStoreContact(payload));
        setStoreLogos(getStoreLogos(payload));
        setHeaderLogo(
          headerLogoWidths(normalizeHeaderSettings(payload.data?.header)),
        );
        footerRef.current = parsed;
        setFooter(parsed);
        setInitialFooter(parsed);
        setUndoStack([]);
        setRedoStack([]);
      } catch {
        toast.error(t("toast.loadFailed"));
      } finally {
        setIsLoading(false);
      }
    };

    void fetchSettings();
  }, [t]);

  const isDirty = useMemo(
    () => JSON.stringify(footer) !== JSON.stringify(initialFooter),
    [footer, initialFooter],
  );
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const commitFooterChange = useCallback(
    (updater: (current: FooterSettings) => FooterSettings) => {
      const current = footerRef.current;
      const next = updater(cloneFooter(current));

      if (areFootersEqual(current, next)) return;

      footerRef.current = next;
      setUndoStack((prev) => [
        ...prev.slice(Math.max(0, prev.length - HISTORY_LIMIT + 1)),
        cloneFooter(current),
      ]);
      setRedoStack([]);
      setFooter(next);
    },
    [],
  );

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      const previous = prev.at(-1);
      if (!previous) return prev;

      const current = footerRef.current;
      footerRef.current = cloneFooter(previous);
      setRedoStack((redo) => [
        ...redo.slice(Math.max(0, redo.length - HISTORY_LIMIT + 1)),
        cloneFooter(current),
      ]);
      setFooter(cloneFooter(previous));
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      const next = prev.at(-1);
      if (!next) return prev;

      const current = footerRef.current;
      footerRef.current = cloneFooter(next);
      setUndoStack((undoHistory) => [
        ...undoHistory.slice(Math.max(0, undoHistory.length - HISTORY_LIMIT + 1)),
        cloneFooter(current),
      ]);
      setFooter(cloneFooter(next));
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const updateField = (path: string, value: unknown) => {
    commitFooterChange((current) => setNestedValue(current, path, value));
  };

  const updateColumn = (
    columnIndex: number,
    field: "title" | "id" | "menuHandle",
    value: string,
  ) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      next.linkColumns[columnIndex][field] = value;
      return next;
    });
  };

  const updateColumnLink = (
    columnIndex: number,
    linkIndex: number,
    field: "label" | "href" | "target",
    value: string,
  ) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      const link = next.linkColumns[columnIndex].links[linkIndex];
      if (field === "target") {
        link.target = value === "_blank" ? "_blank" : "_self";
      } else {
        link[field] = value;
      }
      return next;
    });
  };

  const updateColumnLinkVisibility = (
    columnIndex: number,
    linkIndex: number,
    visible: boolean,
  ) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      next.linkColumns[columnIndex].links[linkIndex].visible = visible;
      return next;
    });
  };

  const addColumn = () => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      const nextNumber = next.linkColumns.length + 1;
      next.linkColumns.push({
        id: `custom-${nextNumber}`,
        title: t("defaults.newColumn"),
        links: [{ label: t("defaults.newLink"), href: "/", target: "_self", visible: true }],
      });
      return next;
    });
  };

  const removeColumn = (columnIndex: number) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      next.linkColumns.splice(columnIndex, 1);
      return next;
    });
  };

  const addLink = (columnIndex: number) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      next.linkColumns[columnIndex].links.push({
        label: t("defaults.newLink"),
        href: "/",
        target: "_self",
        visible: true,
      });
      return next;
    });
  };

  const removeLink = (columnIndex: number, linkIndex: number) => {
    commitFooterChange((current) => {
      const next = cloneFooter(current);
      next.linkColumns[columnIndex].links.splice(linkIndex, 1);
      return next;
    });
  };

  const save = async () => {
    try {
      setIsSaving(true);
      const normalized = normalizeFooterSettings(footer);

      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "footer", data: normalized }),
      });
      const payload = (await response.json()) as SettingsPayload;

      if (!response.ok || payload.success !== true) {
        throw new Error(t("toast.saveFailed"));
      }

      const saved = normalizeFooterSettings(payload.data?.footer);
      footerRef.current = saved;
      setFooter(saved);
      setInitialFooter(saved);
      setUndoStack([]);
      setRedoStack([]);
      toast.success(t("toast.saved"));
    } catch {
      toast.error(t("toast.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  // Same placeholder as `menus/footer/loading.tsx`.
  if (isLoading) return <FooterBuilderSkeleton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={t("title")}
        status={
          <Badge variant={isDirty ? "secondary" : "default"}>
            {isDirty ? t("status.unsaved") : t("status.live")}
          </Badge>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={undo}
              disabled={!canUndo || isSaving}
              size="sm"
              aria-label={t("actions.undoAria")}
              title={t("actions.undoTitle")}
            >
              <Undo2 className="h-4 w-4" />
              {t("actions.undo")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={redo}
              disabled={!canRedo || isSaving}
              size="sm"
              aria-label={t("actions.redoAria")}
              title={t("actions.redoTitle")}
            >
              <Redo2 className="h-4 w-4" />
              {t("actions.redo")}
            </Button>
            <Button onClick={save} disabled={isSaving || !isDirty} size="sm">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("actions.save")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/admin/online-store/menus`}>{t("actions.back")}</Link>
            </Button>
          </>
        }
      />

      <FooterPreview
        footer={footer}
        storeContact={storeContact}
        storeLogos={storeLogos}
        headerLogo={headerLogo}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("brand.title")}</CardTitle>
              <CardDescription>
                {t("brand.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <SourceOptions
                id="footer-logo-source"
                label={t("brand.logoSourceLabel")}
                value={footer.brand.logoSource}
                onChange={(source) => updateField("brand.logoSource", source)}
                store={{
                  title: t("brand.storeLogo"),
                  description: t("brand.storeLogoDescription"),
                }}
                custom={{
                  title: t("brand.customLogo"),
                  description: t("brand.customLogoDescription"),
                }}
              />
              {footer.brand.logoSource === "store" ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="secondary">{t("brand.synced")}</Badge>
                    <Link
                      href={`/${locale}/admin/online-store/theme?tab=branding`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t("brand.editBranding")}
                    </Link>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <StoreLogoSwatch
                      label={t("brand.lightLogo")}
                      url={storeLogos.storeLogoUrl}
                    />
                    <StoreLogoSwatch
                      label={t("brand.darkLogo")}
                      url={storeLogos.storeDarkLogoUrl}
                      dark
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 rounded-lg border p-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("brand.customLogoHint")}
                  </p>
                  <ImageUploadField
                    id="footer-logo"
                    label={t("fields.footerLogo")}
                    value={footer.brand.logoUrl}
                    onChange={(value) => updateField("brand.logoUrl", value)}
                    previewAlt={footer.brand.logoAlt || t("fields.footerLogo")}
                    previewClassName="h-full w-full object-contain"
                  />
                  <ImageUploadField
                    id="footer-dark-logo"
                    label={t("fields.footerDarkLogo")}
                    value={footer.brand.darkLogoUrl}
                    onChange={(value) => updateField("brand.darkLogoUrl", value)}
                    previewAlt={
                      footer.brand.logoAlt || t("fields.footerDarkLogo")
                    }
                    previewClassName="h-full w-full bg-neutral-900 object-contain"
                  />
                </div>
              )}
              <div className="space-y-3">
                <SwitchRow
                  label={t("brand.matchHeaderSize")}
                  checked={footer.brand.logoSize === 0}
                  // Unticking starts from the header's size, so the logo
                  // does not jump the moment it becomes editable.
                  onChange={(match) =>
                    updateField("brand.logoSize", match ? 0 : headerLogo.desktop)
                  }
                />
                {footer.brand.logoSize === 0 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("brand.matchHeaderSizeHint", {
                      desktop: headerLogo.desktop,
                      mobile: headerLogo.mobile,
                    })}
                  </p>
                ) : (
                  <FieldRow label={t("fields.logoWidth")}>
                    <div className="relative">
                      <NumberInput
                        aria-label={t("fields.logoWidth")}
                        min={MIN_HEADER_LOGO_SIZE}
                        max={MAX_HEADER_LOGO_SIZE}
                        step={1}
                        value={footer.brand.logoSize}
                        whenEmpty="keep"
                        normalize={Math.round}
                        onValueChange={(next) => {
                          if (next !== undefined) {
                            updateField("brand.logoSize", next);
                          }
                        }}
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                        px
                      </span>
                    </div>
                  </FieldRow>
                )}
                <FieldRow label={t("fields.logoTheme")}>
                  <NativeSelect
                    value={footer.brand.logoTheme}
                    onChange={(event) =>
                      updateField(
                        "brand.logoTheme",
                        FOOTER_LOGO_THEMES.find(
                          (theme) => theme === event.target.value,
                        ) ?? "auto",
                      )
                    }
                  >
                    <option value="auto">{t("brand.logoThemeAuto")}</option>
                    <option value="light">{t("brand.lightLogo")}</option>
                    <option value="dark">{t("brand.darkLogo")}</option>
                  </NativeSelect>
                </FieldRow>
              </div>
              <FieldRow label={t("fields.logoAlt")}>
                <Input
                  value={footer.brand.logoAlt}
                  placeholder={storeName}
                  onChange={(event) =>
                    updateField("brand.logoAlt", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label={t("fields.aboutDescription")}>
                <Textarea
                  value={footer.brand.description}
                  rows={4}
                  onChange={(event) =>
                    updateField("brand.description", event.target.value)
                  }
                />
              </FieldRow>
              <SwitchRow
                label={t("fields.fullWidthFooter")}
                checked={footer.layout.fullWidth}
                onChange={(value) => updateField("layout.fullWidth", value)}
              />
              <Separator />
              <ColorSchemeFields
                title={t("colors.light")}
                scheme={footer.colors.light}
                pathPrefix="colors.light"
                onChange={updateField}
              />
              <ColorSchemeFields
                title={t("colors.dark")}
                scheme={footer.colors.dark}
                pathPrefix="colors.dark"
                onChange={updateField}
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("quickLinks.title")}</CardTitle>
              <CardDescription>
                {t("quickLinks.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {footer.linkColumns.map((column, columnIndex) => (
                <div key={`${column.id}-${columnIndex}`} className="rounded-md border p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <NativeSelect
                      className="w-40 shrink-0"
                      value={column.menuHandle || ""}
                      onChange={(event) =>
                        updateColumn(
                          columnIndex,
                          "menuHandle",
                          event.target.value,
                        )
                      }
                      aria-label={tf("quickLinks.source", "Link source")}
                    >
                      <option value="">
                        {tf("quickLinks.customLinks", "Custom links")}
                      </option>
                      {availableMenus.map((menu) => (
                        <option key={menu.handle} value={menu.handle}>
                          {menu.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      value={column.title}
                      placeholder={
                        column.menuHandle
                          ? (availableMenus.find(
                              (menu) => menu.handle === column.menuHandle,
                            )?.name ?? "")
                          : ""
                      }
                      onChange={(event) =>
                        updateColumn(columnIndex, "title", event.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeColumn(columnIndex)}
                      disabled={footer.linkColumns.length <= 1}
                      aria-label={t("quickLinks.removeColumn")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {column.menuHandle ? (
                    <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                      {tf(
                        "quickLinks.menuSourceHint",
                        "This column shows the selected menu's links. Edit them under Online Store → Navigation.",
                      )}
                    </p>
                  ) : (
                  <div className="space-y-2">
                    {column.links.map((link, linkIndex) => (
                      <div
                        key={`${column.id}-link-${linkIndex}`}
                        className="grid gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_84px_36px]"
                      >
                        <Input
                          value={link.label}
                          placeholder={t("quickLinks.labelPlaceholder")}
                          onChange={(event) =>
                            updateColumnLink(
                              columnIndex,
                              linkIndex,
                              "label",
                              event.target.value,
                            )
                          }
                        />
                        <Input
                          value={link.href}
                          placeholder="/page"
                          onChange={(event) =>
                            updateColumnLink(
                              columnIndex,
                              linkIndex,
                              "href",
                              event.target.value,
                            )
                          }
                        />
                        <NativeSelect
                          value={link.target}
                          onChange={(event) =>
                            updateColumnLink(
                              columnIndex,
                              linkIndex,
                              "target",
                              event.target.value,
                            )
                          }
                        >
                          <option value="_self">{t("quickLinks.sameTab")}</option>
                          <option value="_blank">{t("quickLinks.newTab")}</option>
                        </NativeSelect>
                        <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-background px-3">
                          <Label className="m-0 text-xs text-muted-foreground">
                            {t("quickLinks.show")}
                          </Label>
                          <Switch
                            checked={link.visible}
                            onCheckedChange={(value) =>
                              updateColumnLinkVisibility(
                                columnIndex,
                                linkIndex,
                                value,
                              )
                            }
                            aria-label={t("quickLinks.showLinkAria", {
                              label: link.label || t("quickLinks.quickPage"),
                            })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeLink(columnIndex, linkIndex)}
                          disabled={column.links.length <= 1}
                          aria-label={t("quickLinks.removeLink")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  )}
                  {!column.menuHandle && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => addLink(columnIndex)}
                      disabled={column.links.length >= 8}
                    >
                      <Plus className="h-4 w-4" />
                      {t("quickLinks.addLink")}
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={addColumn}
                disabled={footer.linkColumns.length >= 6}
              >
                <Plus className="h-4 w-4" />
                {t("quickLinks.addColumn")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("widgets.title")}</CardTitle>
              <CardDescription>
                {t("widgets.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SwitchRow
                label={t("fields.showFooterLogo")}
                checked={footer.widgets.showLogo}
                onChange={(value) => updateField("widgets.showLogo", value)}
              />
              <SwitchRow
                label={t("fields.showAboutDescription")}
                checked={footer.widgets.showDescription}
                onChange={(value) => updateField("widgets.showDescription", value)}
              />
              <SwitchRow
                label={t("fields.showContactInfo")}
                checked={footer.widgets.showContact}
                onChange={(value) => updateField("widgets.showContact", value)}
              />
              <SwitchRow
                label={t("fields.showSocialLinks")}
                checked={footer.widgets.showSocialLinks}
                onChange={(value) => updateField("widgets.showSocialLinks", value)}
              />
              <SwitchRow
                label={t("fields.showQuickPageLinks")}
                checked={footer.widgets.showLinkColumns}
                onChange={(value) => updateField("widgets.showLinkColumns", value)}
              />
              <SwitchRow
                label={t("fields.showCopyright")}
                checked={footer.widgets.showCopyright}
                onChange={(value) => updateField("widgets.showCopyright", value)}
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("contact.title")}</CardTitle>
              <CardDescription>{t("contact.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow label={t("fields.widgetTitle")}>
                <Input
                  value={footer.contact.title}
                  onChange={(event) => updateField("contact.title", event.target.value)}
                />
              </FieldRow>

              <SourceOptions
                id="footer-contact-source"
                label={t("contact.sourceLabel")}
                value={footer.contact.source}
                onChange={(source) => updateField("contact.source", source)}
                store={{
                  title: t("contact.storeSource"),
                  description: t("contact.storeSourceDescription"),
                }}
                custom={{
                  title: t("contact.customSource"),
                  description: t("contact.customSourceDescription"),
                }}
              />

              {footer.contact.source === "store" ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="secondary">{t("contact.synced")}</Badge>
                    <Link
                      href={`/${locale}/admin/settings/general/store-info`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t("contact.editStoreInformation")}
                    </Link>
                  </div>
                  <dl className="grid gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("fields.phone")}
                      </dt>
                      <dd className="break-words font-medium">
                        {storeContact.phone || t("contact.notSet")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("fields.email")}
                      </dt>
                      <dd className="break-all font-medium">
                        {storeContact.email || t("contact.notSet")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {t("fields.address")}
                      </dt>
                      <dd className="break-words font-medium">
                        {storeContact.address || t("contact.notSet")}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <div className="space-y-4 rounded-lg border p-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("contact.customFieldsHint")}
                  </p>
                  <FieldRow label={t("fields.phone")}>
                    <Input
                      value={footer.contact.phone}
                      onChange={(event) =>
                        updateField("contact.phone", event.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow label={t("fields.email")}>
                    <Input
                      type="email"
                      value={footer.contact.email}
                      onChange={(event) =>
                        updateField("contact.email", event.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow label={t("fields.address")}>
                    <Textarea
                      value={footer.contact.address}
                      rows={3}
                      onChange={(event) =>
                        updateField("contact.address", event.target.value)
                      }
                    />
                  </FieldRow>
                </div>
              )}
              <div className="grid gap-3">
                <SwitchRow
                  label={t("fields.showPhone")}
                  checked={footer.contact.showPhone}
                  onChange={(value) => updateField("contact.showPhone", value)}
                />
                <SwitchRow
                  label={t("fields.showEmail")}
                  checked={footer.contact.showEmail}
                  onChange={(value) => updateField("contact.showEmail", value)}
                />
                <SwitchRow
                  label={t("fields.showAddress")}
                  checked={footer.contact.showAddress}
                  onChange={(value) => updateField("contact.showAddress", value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("social.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow label={t("fields.widgetTitle")}>
                <Input
                  value={footer.social.title}
                  onChange={(event) => updateField("social.title", event.target.value)}
                />
              </FieldRow>
              {socialFields.map((field) => (
                <FieldRow key={field.key} label={field.label}>
                  <Input
                    value={footer.social.links[field.key]}
                    placeholder="https://"
                    onChange={(event) =>
                      updateField(`social.links.${field.key}`, event.target.value)
                    }
                  />
                </FieldRow>
              ))}
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("copyright.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldRow label={t("fields.copyrightText")}>
                <Input
                  value={footer.copyright.text}
                  onChange={(event) =>
                    updateField("copyright.text", event.target.value)
                  }
                />
              </FieldRow>
              <SwitchRow
                label={t("fields.showYear")}
                checked={footer.copyright.showYear}
                onChange={(value) => updateField("copyright.showYear", value)}
              />
              <SwitchRow
                label={t("fields.showStoreName")}
                checked={footer.copyright.showStoreName}
                onChange={(value) => updateField("copyright.showStoreName", value)}
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t("payment.title")}</CardTitle>
              <CardDescription>
                {t("payment.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SwitchRow
                label={t("fields.showPaymentMethods")}
                checked={footer.paymentMethods.enabled}
                onChange={(value) => updateField("paymentMethods.enabled", value)}
              />
              <ImageUploadField
                id="footer-payment-methods"
                label={t("fields.paymentMethods")}
                value={footer.paymentMethods.imageUrl}
                onChange={(value) => updateField("paymentMethods.imageUrl", value)}
                previewAlt={footer.paymentMethods.imageAlt || t("fields.paymentMethods")}
                previewClassName="h-full w-full object-contain"
              />
              <FieldRow label={t("fields.imageAlt")}>
                <Input
                  value={footer.paymentMethods.imageAlt}
                  onChange={(event) =>
                    updateField("paymentMethods.imageAlt", event.target.value)
                  }
                />
              </FieldRow>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FooterPreview({
  footer,
  storeContact,
  storeLogos,
  headerLogo,
}: {
  footer: FooterSettings;
  storeContact: FooterContactDetails;
  storeLogos: StoreLogos;
  headerLogo: LogoWidths;
}) {
  const t = useTranslations("admin.footerCms");
  // The live store name — the preview has to show what the storefront footer
  // will actually render, which is `general.storeName` and never this app's.
  const { storeName } = useAppSettings();
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");
  const colors = footer.colors[previewMode];
  const contact = resolveFooterContactDetails(footer.contact, storeContact);
  const logoUrl = resolveFooterLogoUrl({
    brand: footer.brand,
    ...storeLogos,
    isDark: previewMode === "dark",
    backgroundColor: colors.backgroundColor,
  });
  // The preview is the desktop footer, so it draws the `lg`-up width.
  const logoWidth = resolveFooterLogoWidths(
    footer.brand.logoSize,
    headerLogo,
  ).desktop;
  const socialCount = Object.values(footer.social.links).filter((value) =>
    value.trim(),
  ).length;
  const showPaymentMethods =
    footer.widgets.showPaymentMethods &&
    footer.paymentMethods.enabled &&
    footer.paymentMethods.imageUrl.trim();

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="border-b bg-muted/35 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{t("preview.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("preview.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-background p-1">
              <button
                type="button"
                onClick={() => setPreviewMode("light")}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-sm transition-colors",
                  previewMode === "light"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                aria-label={t("preview.lightMode")}
              >
                <Sun className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode("dark")}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-sm transition-colors",
                  previewMode === "dark"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                aria-label={t("preview.darkMode")}
              >
                <Moon className="h-4 w-4" />
              </button>
            </div>
            <Badge variant="outline">
              {footer.layout.fullWidth ? t("preview.fullWidth") : t("preview.contained")}
            </Badge>
          </div>
        </div>
      </div>
      <div className="bg-muted/20 p-4">
        <div
          className={cn(
            "mx-auto overflow-hidden rounded-md border shadow-sm",
            footer.layout.fullWidth ? "w-full" : "max-w-6xl",
          )}
          style={
            {
              "--preview-footer-bg": colors.backgroundColor,
              "--preview-footer-text": colors.textColor,
              "--preview-footer-muted": colors.mutedTextColor,
              "--preview-footer-border": colors.borderColor,
              "--preview-footer-accent": colors.accentColor,
              backgroundColor: "var(--preview-footer-bg)",
              color: "var(--preview-footer-text)",
              borderColor: "var(--preview-footer-border)",
            } as CSSProperties
          }
        >
          <div className="grid grid-cols-2 gap-6 p-5 md:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2">
              {footer.widgets.showLogo ? (
                <div className="mb-4 flex items-center gap-2">
                  {logoUrl ? (
                    <span
                      className="relative block max-w-full"
                      style={{ width: logoWidth }}
                    >
                      <AppImage
                        src={logoUrl}
                        alt={footer.brand.logoAlt || t("fields.footerLogo")}
                        width={Math.round(logoWidth)}
                        height={Math.round(logoWidth / 4)}
                        className="h-auto w-full object-contain object-left"
                      />
                    </span>
                  ) : (
                    <>
                      <Store
                        className="h-6 w-6"
                        style={{ color: "var(--preview-footer-accent)" }}
                      />
                      <span className="text-xl font-bold">{storeName}</span>
                    </>
                  )}
                </div>
              ) : null}
              {footer.widgets.showDescription ? (
                <p
                  className="mb-4 max-w-xs text-sm"
                  style={{ color: "var(--preview-footer-muted)" }}
                >
                  {footer.brand.description ||
                    t("preview.descriptionFallback")}
                </p>
              ) : null}
              {footer.widgets.showContact ? (
                <div
                  className="space-y-2 text-sm"
                  style={{ color: "var(--preview-footer-muted)" }}
                >
                  <p
                    className="font-semibold"
                    style={{ color: "var(--preview-footer-text)" }}
                  >
                    {footer.contact.title}
                  </p>
                  {footer.contact.showPhone && contact.phone ? (
                    <PreviewContact icon={<Phone className="h-4 w-4" />}>
                      {contact.phone}
                    </PreviewContact>
                  ) : null}
                  {footer.contact.showEmail && contact.email ? (
                    <PreviewContact icon={<Mail className="h-4 w-4" />}>
                      {contact.email}
                    </PreviewContact>
                  ) : null}
                  {footer.contact.showAddress && contact.address ? (
                    <PreviewContact icon={<MapPin className="h-4 w-4" />}>
                      {contact.address}
                    </PreviewContact>
                  ) : null}
                </div>
              ) : null}
            </div>

            {footer.widgets.showLinkColumns
              ? footer.linkColumns
                  .map((column) => ({
                    ...column,
                    links: column.links.filter((link) => link.visible),
                  }))
                  .filter((column) => column.links.length > 0)
                  .slice(0, 4)
                  .map((column, index) => (
                    <div key={`${column.id}-${index}`}>
                      <p className="mb-3 font-semibold">{column.title}</p>
                      <div
                        className="space-y-2 text-sm"
                        style={{ color: "var(--preview-footer-muted)" }}
                      >
                        {column.links.slice(0, 5).map((link, linkIndex) => (
                          <p key={`${link.href}-${linkIndex}`}>{link.label}</p>
                        ))}
                      </div>
                    </div>
                  ))
              : null}
          </div>
          <div
            className="border-t px-5 py-4"
            style={{ borderColor: "var(--preview-footer-border)" }}
          >
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              {footer.widgets.showCopyright ? (
                <p className="text-sm" style={{ color: "var(--preview-footer-muted)" }}>
                  {"\u00a9"} {footer.copyright.showYear ? new Date().getFullYear() : ""}
                  {footer.copyright.showStoreName ? ` ${storeName}. ` : " "}
                  {footer.copyright.text}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-center gap-4">
                {showPaymentMethods ? (
                  <AppImage
                    src={footer.paymentMethods.imageUrl}
                    alt={footer.paymentMethods.imageAlt || t("fields.paymentMethods")}
                    width={220}
                    height={34}
                    className="h-8 max-w-[220px] object-contain"
                  />
                ) : null}
                {footer.widgets.showSocialLinks && socialCount > 0 ? (
                  <div
                    className="flex items-center gap-3"
                    style={{ color: "var(--preview-footer-muted)" }}
                  >
                    <Facebook className="h-4 w-4" />
                    <Twitter className="h-4 w-4" />
                    <Instagram className="h-4 w-4" />
                    <Youtube className="h-4 w-4" />
                    <Linkedin className="h-4 w-4" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PreviewContact({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="line-clamp-2">{children}</span>
    </div>
  );
}

/**
 * "Follow the store" vs "footer only", as two radio cards. The store's value
 * is the default everywhere it is offered: a footer-only value applies only
 * after the admin picks it, so nothing copied silently goes stale.
 */
function SourceOptions({
  id,
  label,
  value,
  onChange,
  store,
  custom,
}: {
  id: string;
  label: string;
  value: FooterSource;
  onChange: (source: FooterSource) => void;
  store: { title: string; description: string };
  custom: { title: string; description: string };
}) {
  const options = [
    { source: "store", ...store },
    { source: "custom", ...custom },
  ] as const;

  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next === "custom" ? "custom" : "store")}
      className="grid gap-3 sm:grid-cols-2"
      aria-label={label}
    >
      {options.map((option) => (
        <label
          key={option.source}
          htmlFor={`${id}-${option.source}`}
          className={cn(
            "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
            value === option.source
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/50",
          )}
        >
          <RadioGroupItem
            id={`${id}-${option.source}`}
            value={option.source}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">{option.title}</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              {option.description}
            </span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** One of the store's Branding logos, on the surface it is drawn for. */
function StoreLogoSwatch({
  label,
  url,
  dark = false,
}: {
  label: string;
  url: string;
  dark?: boolean;
}) {
  const t = useTranslations("admin.footerCms");
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div
        className={cn(
          "flex h-14 items-center rounded-md border px-3",
          dark ? "bg-neutral-900" : "bg-white",
        )}
      >
        {url ? (
          <AppImage
            src={url}
            alt={label}
            width={144}
            height={32}
            className="h-8 w-full object-contain object-left"
          />
        ) : (
          <span
            className={cn(
              "text-xs",
              dark ? "text-neutral-400" : "text-neutral-500",
            )}
          >
            {t("brand.logoNotSet")}
          </span>
        )}
      </div>
    </div>
  );
}

function ColorSchemeFields({
  title,
  scheme,
  pathPrefix,
  onChange,
}: {
  title: string;
  scheme: FooterColorScheme;
  pathPrefix: string;
  onChange: (path: string, value: string) => void;
}) {
  const t = useTranslations("admin.footerCms");
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <ColorField
          label={t("fields.footerBackgroundColor")}
          value={scheme.backgroundColor}
          onChange={(value) => onChange(`${pathPrefix}.backgroundColor`, value)}
        />
        <ColorField
          label={t("fields.footerTextColor")}
          value={scheme.textColor}
          onChange={(value) => onChange(`${pathPrefix}.textColor`, value)}
        />
        <ColorField
          label={t("fields.mutedTextColor")}
          value={scheme.mutedTextColor}
          onChange={(value) => onChange(`${pathPrefix}.mutedTextColor`, value)}
        />
        <ColorField
          label={t("fields.borderColor")}
          value={scheme.borderColor}
          onChange={(value) => onChange(`${pathPrefix}.borderColor`, value)}
        />
        <ColorField
          label={t("fields.accentColor")}
          value={scheme.accentColor}
          onChange={(value) => onChange(`${pathPrefix}.accentColor`, value)}
        />
      </div>
    </div>
  );
}
