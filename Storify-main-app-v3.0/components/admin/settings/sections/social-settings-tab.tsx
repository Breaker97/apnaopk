"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Facebook,
  Linkedin,
  Link2,
  Mail,
  Plus,
  Send,
  Share2,
  Trash2,
  ImageDown,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import type {
  CustomShareButton,
  Settings,
  SocialShareSettings,
} from "@/components/admin/settings/types";
import { resolveShareSettings } from "@/lib/site-config/share-config";
import { cn } from "@/lib/utils";
import {
  MediaUploader,
  type UploadedMedia,
} from "@/components/ui/media-uploader";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type ShareToggleKey = Exclude<keyof SocialShareSettings, "custom">;

function createCustomId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SocialSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;

  const tr = useFallbackTranslator(t);

  const share = resolveShareSettings(settings.social?.share);
  const setShare = (key: ShareToggleKey, value: boolean) =>
    updateNestedField(`social.share.${key}`, value);

  const customButtons = share.custom;
  const setCustom = (next: CustomShareButton[]) =>
    updateNestedField("social.share.custom", next);
  const addCustom = () =>
    setCustom([
      ...customButtons,
      { id: createCustomId(), label: "", urlTemplate: "", enabled: true },
    ]);
  const updateCustom = (index: number, patch: Partial<CustomShareButton>) =>
    setCustom(
      customButtons.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  const removeCustom = (index: number) =>
    setCustom(customButtons.filter((_, i) => i !== index));

  const channels: Array<{
    key: ShareToggleKey;
    label: string;
    icon: typeof Facebook;
  }> = [
    {
      key: "facebook",
      label: tr("admin.settings.social.share.facebook", "Facebook"),
      icon: Facebook,
    },
    {
      key: "twitter",
      label: tr("admin.settings.social.share.twitter", "X / Twitter"),
      icon: Share2,
    },
    {
      key: "whatsapp",
      label: tr("admin.settings.social.share.whatsapp", "WhatsApp"),
      icon: MessageCircle,
    },
    {
      key: "telegram",
      label: tr("admin.settings.social.share.telegram", "Telegram"),
      icon: Send,
    },
    {
      key: "pinterest",
      label: tr("admin.settings.social.share.pinterest", "Pinterest"),
      icon: ImageDown,
    },
    {
      key: "linkedin",
      label: tr("admin.settings.social.share.linkedin", "LinkedIn"),
      icon: Linkedin,
    },
    {
      key: "email",
      label: tr("admin.settings.social.share.email", "Email"),
      icon: Mail,
    },
  ];

  const disabledCls = share.enabled
    ? "opacity-100"
    : "pointer-events-none select-none opacity-50";

  return (
    <div className="space-y-4 pb-24">
      <SettingsTabHeader
        title={t("admin.settings.social.title")}
        description={t("admin.settings.social.description")}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="facebookUrl">
                {t("admin.settings.social.facebook")}
              </Label>
              <Input
                id="facebookUrl"
                value={settings.social?.facebookUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.facebookUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.facebookPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twitterUrl">
                {t("admin.settings.social.twitter")}
              </Label>
              <Input
                id="twitterUrl"
                value={settings.social?.twitterUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.twitterUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.twitterPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instagramUrl">
                {t("admin.settings.social.instagram")}
              </Label>
              <Input
                id="instagramUrl"
                value={settings.social?.instagramUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.instagramUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.instagramPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="youtubeUrl">
                {t("admin.settings.social.youtube")}
              </Label>
              <Input
                id="youtubeUrl"
                value={settings.social?.youtubeUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.youtubeUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.youtubePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">
                {t("admin.settings.social.linkedin")}
              </Label>
              <Input
                id="linkedinUrl"
                value={settings.social?.linkedinUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.linkedinUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.linkedinPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tiktokUrl">
                {t("admin.settings.social.tiktok")}
              </Label>
              <Input
                id="tiktokUrl"
                value={settings.social?.tiktokUrl || ""}
                onChange={(e) =>
                  updateNestedField("social.tiktokUrl", e.target.value)
                }
                placeholder={t("admin.settings.social.tiktokPlaceholder")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <SettingsTabHeader
        title={tr("admin.settings.social.share.title", "Share Buttons")}
        description={tr(
          "admin.settings.social.share.description",
          "Choose which share buttons appear on your product pages.",
        )}
      />

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <h4 className="font-medium">
                {tr(
                  "admin.settings.social.share.enable",
                  "Enable share buttons",
                )}
              </h4>
              <p className="text-sm text-muted-foreground">
                {tr(
                  "admin.settings.social.share.enableDesc",
                  "Show a row of share buttons on product detail pages.",
                )}
              </p>
            </div>
            <Switch
              checked={share.enabled}
              onCheckedChange={(value) => setShare("enabled", value)}
            />
          </div>

          <div
            className={cn("space-y-6 transition-opacity", disabledCls)}
            aria-disabled={!share.enabled}
          >
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground/80">
                {tr("admin.settings.social.share.linkGroup", "Link")}
              </p>
              <ShareToggleRow
                icon={Link2}
                label={tr("admin.settings.social.share.copyLink", "Copy link")}
                description={tr(
                  "admin.settings.social.share.copyLinkDesc",
                  "A button that copies the product link to the clipboard.",
                )}
                checked={share.copyLink}
                disabled={!share.enabled}
                onChange={(value) => setShare("copyLink", value)}
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground/80">
                {tr(
                  "admin.settings.social.share.socialGroup",
                  "Social networks",
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {channels.map((channel) => (
                  <ShareToggleRow
                    key={channel.key}
                    icon={channel.icon}
                    label={channel.label}
                    checked={Boolean(share[channel.key])}
                    disabled={!share.enabled}
                    onChange={(value) => setShare(channel.key, value)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground/80">
                  {tr(
                    "admin.settings.social.share.customGroup",
                    "Custom platforms",
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "admin.settings.social.share.customHint",
                    "Add any other platform with its own share link.",
                  )}
                </p>
              </div>

              {customButtons.length > 0 ? (
                <div className="space-y-3">
                  {customButtons.map((item, index) => (
                    <CustomShareRow
                      key={item.id || index}
                      item={item}
                      disabled={!share.enabled}
                      labelLabel={tr(
                        "admin.settings.social.share.customLabel",
                        "Label",
                      )}
                      labelPlaceholder={tr(
                        "admin.settings.social.share.customLabelPlaceholder",
                        "e.g. Reddit",
                      )}
                      untitledLabel={tr(
                        "admin.settings.social.share.customUntitled",
                        "Untitled platform",
                      )}
                      urlLabel={tr(
                        "admin.settings.social.share.customUrl",
                        "Share link",
                      )}
                      iconLabel={tr(
                        "admin.settings.social.share.customIcon",
                        "Icon",
                      )}
                      iconHint={tr(
                        "admin.settings.social.share.customIconHint",
                        "Optional. Upload a square image, or paste an image URL. Falls back to a generic share icon.",
                      )}
                      hintPrefix={tr(
                        "admin.settings.social.share.customUrlHint",
                        "Insert the product link and title with the tokens:",
                      )}
                      removeLabel={tr(
                        "admin.settings.social.share.customRemove",
                        "Remove platform",
                      )}
                      onChange={(patch) => updateCustom(index, patch)}
                      onRemove={() => removeCustom(index)}
                    />
                  ))}
                </div>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!share.enabled}
                onClick={addCustom}
              >
                <Plus className="h-4 w-4" />
                {tr("admin.settings.social.share.customAdd", "Add platform")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <StickySaveFooter
        label={t("admin.settings.social.save")}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={onSave}
      />
    </div>
  );
}

function ShareToggleRow(props: {
  icon: typeof Facebook;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { icon: Icon, label, description, checked, disabled, onChange } = props;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium text-foreground">
            {label}
          </p>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function CustomShareRow(props: {
  item: CustomShareButton;
  disabled?: boolean;
  labelLabel: string;
  labelPlaceholder: string;
  untitledLabel: string;
  urlLabel: string;
  iconLabel: string;
  iconHint: string;
  hintPrefix: string;
  removeLabel: string;
  onChange: (patch: Partial<CustomShareButton>) => void;
  onRemove: () => void;
}) {
  const {
    item,
    disabled,
    labelLabel,
    labelPlaceholder,
    untitledLabel,
    urlLabel,
    iconLabel,
    iconHint,
    hintPrefix,
    removeLabel,
    onChange,
    onRemove,
  } = props;

  // New/unnamed platforms open in edit mode; configured ones collapse to a
  // compact row that mirrors the social-network toggles above.
  const [expanded, setExpanded] = useState(() => !item.label.trim());
  const hasLabel = Boolean(item.label.trim());

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
            {item.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.icon}
                alt=""
                className="h-full w-full object-contain"
                aria-hidden
              />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              hasLabel ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {hasLabel ? item.label : untitledLabel}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        <div className="flex items-center gap-1">
          <Switch
            checked={item.enabled}
            disabled={disabled}
            onCheckedChange={(value) => onChange({ enabled: value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={removeLabel}
            title={removeLabel}
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t p-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {labelLabel}
            </Label>
            <Input
              value={item.label}
              disabled={disabled}
              placeholder={labelPlaceholder}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{urlLabel}</Label>
            <Input
              value={item.urlTemplate}
              disabled={disabled}
              placeholder="https://example.com/share?url={url}&title={title}"
              onChange={(e) => onChange({ urlTemplate: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {hintPrefix}{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {"{url}"}
              </code>{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {"{title}"}
              </code>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{iconLabel}</Label>
            <MediaUploader
              maxFiles={1}
              acceptTypes={["image"]}
              disabled={disabled}
              previewFit="contain"
              value={
                item.icon
                  ? [
                      {
                        _id: `custom-share-icon-${item.id}`,
                        url: item.icon,
                        type: "image",
                        mimeType: "image/*",
                        alt: item.label || iconLabel,
                        position: 0,
                      } as UploadedMedia,
                    ]
                  : []
              }
              onChange={(items) => {
                const icon = items.find((entry) => entry.type === "image");
                onChange({ icon: icon?.url || "" });
              }}
            />
            <p className="text-xs text-muted-foreground">{iconHint}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
