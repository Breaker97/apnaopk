"use client";

import { useState } from "react";
import {
  ChevronDown,
  Facebook,
  ImageDown,
  Link2,
  Linkedin,
  Mail,
  MessageCircle,
  Plus,
  Send,
  Share2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MediaUploader,
  type UploadedMedia,
} from "@/components/ui/media-uploader";
import {
  resolveShareSettings,
  type CustomShareButton,
  type ShareSettings,
} from "@/lib/site-config/share-config";
import { cn } from "@/lib/utils";

type ShareToggleKey = Exclude<keyof ShareSettings, "custom">;

interface VendorShareSettingsProps {
  value: ShareSettings;
  onChange: (value: ShareSettings) => void;
}

function createCustomId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function VendorShareSettings({
  value,
  onChange,
}: VendorShareSettingsProps) {
  const share = resolveShareSettings(value);
  const disabledCls = share.enabled
    ? "opacity-100"
    : "pointer-events-none select-none opacity-50";

  const setShare = (key: ShareToggleKey, nextValue: boolean) => {
    onChange({ ...share, [key]: nextValue });
  };

  const setCustom = (custom: CustomShareButton[]) => {
    onChange({ ...share, custom });
  };

  const addCustom = () => {
    setCustom([
      ...share.custom,
      { id: createCustomId(), label: "", urlTemplate: "", enabled: true },
    ]);
  };

  const updateCustom = (index: number, patch: Partial<CustomShareButton>) => {
    setCustom(
      share.custom.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const removeCustom = (index: number) => {
    setCustom(share.custom.filter((_item, itemIndex) => itemIndex !== index));
  };

  const channels: Array<{
    key: ShareToggleKey;
    label: string;
    icon: LucideIcon;
  }> = [
    { key: "facebook", label: "Facebook", icon: Facebook },
    { key: "twitter", label: "X / Twitter", icon: Share2 },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
    { key: "telegram", label: "Telegram", icon: Send },
    { key: "pinterest", label: "Pinterest", icon: ImageDown },
    { key: "linkedin", label: "LinkedIn", icon: Linkedin },
    { key: "email", label: "Email", icon: Mail },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share Buttons</CardTitle>
        <CardDescription>
          Choose which share buttons appear on your public vendor store profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <h4 className="font-medium">Enable share buttons</h4>
            <p className="text-sm text-muted-foreground">
              Show share actions on your storefront vendor profile.
            </p>
          </div>
          <Switch
            checked={share.enabled}
            onCheckedChange={(checked) => setShare("enabled", checked)}
          />
        </div>

        <div
          className={cn("space-y-6 transition-opacity", disabledCls)}
          aria-disabled={!share.enabled}
        >
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground/80">Link</p>
            <ShareToggleRow
              icon={Link2}
              label="Copy link"
              description="A button that copies your vendor store URL."
              checked={share.copyLink}
              disabled={!share.enabled}
              onChange={(checked) => setShare("copyLink", checked)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground/80">
              Social networks
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.map((channel) => (
                <ShareToggleRow
                  key={channel.key}
                  icon={channel.icon}
                  label={channel.label}
                  checked={Boolean(share[channel.key])}
                  disabled={!share.enabled}
                  onChange={(checked) => setShare(channel.key, checked)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground/80">
                Custom platforms
              </p>
              <p className="text-xs text-muted-foreground">
                Add another share destination with its own URL template.
              </p>
            </div>

            {share.custom.length > 0 ? (
              <div className="space-y-3">
                {share.custom.map((item, index) => (
                  <CustomShareRow
                    key={item.id || index}
                    item={item}
                    disabled={!share.enabled}
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
              Add platform
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ShareToggleRow(props: {
  icon: LucideIcon;
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
  onChange: (patch: Partial<CustomShareButton>) => void;
  onRemove: () => void;
}) {
  const { item, disabled, onChange, onRemove } = props;
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
            {hasLabel ? item.label : "Untitled platform"}
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
            onCheckedChange={(checked) => onChange({ enabled: checked })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Remove platform"
            title="Remove platform"
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
            <Label className="text-xs text-muted-foreground">Label</Label>
            <Input
              value={item.label}
              disabled={disabled}
              placeholder="e.g. Reddit"
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Share link</Label>
            <Input
              value={item.urlTemplate}
              disabled={disabled}
              placeholder="https://example.com/share?url={url}&title={title}"
              onChange={(event) =>
                onChange({ urlTemplate: event.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Insert the vendor store link and title with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {"{url}"}
              </code>{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {"{title}"}
              </code>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Icon</Label>
            <MediaUploader
              maxFiles={1}
              acceptTypes={["image"]}
              disabled={disabled}
              previewFit="contain"
              value={
                item.icon
                  ? [
                      {
                        _id: `vendor-share-icon-${item.id}`,
                        url: item.icon,
                        type: "image",
                        mimeType: "image/*",
                        alt: item.label || "Share icon",
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
            <p className="text-xs text-muted-foreground">
              Optional. Upload a square image, or leave it empty for the share
              icon.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
