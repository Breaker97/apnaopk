"use client";

import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Eye, Palette, Plus, Sliders } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { MediaUploader } from "@/components/ui/media-uploader";
import {
  AISalesAssistantAvatar,
  AISalesHeaderIcon,
} from "@/components/ai-sales-agent/ai-sales-message";
import type { IAISalesAgentSettings } from "@/models/settings.model";

interface WidgetTabProps {
  settings: IAISalesAgentSettings;
  setSettings: Dispatch<SetStateAction<IAISalesAgentSettings>>;
  faviconUrl: string;
}

export function WidgetTab({ settings, setSettings, faviconUrl }: WidgetTabProps) {
  const t = useTranslations("aiSalesAgentAdmin");

  return (
    <TabsContent value="widget" className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" />
              {t("widget.appearance.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{t("widget.appearance.headerTitle")}</Label>
              <Input
                value={settings.widget.headerTitle || ""}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    widget: {
                      ...prev.widget,
                      headerTitle: event.target.value,
                    },
                  }))
                }
                placeholder={settings.agentName}
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                {t("widget.appearance.headerTitleDescription")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t("widget.appearance.position")}</Label>
              <Select
                value={settings.widget.position}
                onValueChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    widget: {
                      ...prev.widget,
                      position:
                        value as IAISalesAgentSettings["widget"]["position"],
                    },
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom-right">
                    {t("widget.appearance.positionBottomRight")}
                  </SelectItem>
                  <SelectItem value="bottom-left">
                    {t("widget.appearance.positionBottomLeft")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <Sliders className="h-3.5 w-3.5" />
                  {t("widget.appearance.expandedSize")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("widget.appearance.expandedSizeDescription")}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("widget.appearance.width")}
                  </Label>
                  <div className="relative">
                    <NumberInput
                      min={320}
                      max={640}
                      step={1}
                      value={settings.widget.width}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next === undefined) return;
                        setSettings((prev) => ({
                          ...prev,
                          widget: { ...prev.widget, width: next },
                        }));
                      }}
                      className="pr-10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      px
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("widget.appearance.widthRange")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("widget.appearance.height")}
                  </Label>
                  <div className="relative">
                    <NumberInput
                      min={420}
                      max={900}
                      step={1}
                      value={settings.widget.height}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next === undefined) return;
                        setSettings((prev) => ({
                          ...prev,
                          widget: { ...prev.widget, height: next },
                        }));
                      }}
                      className="pr-10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      px
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("widget.appearance.heightRange")}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("widget.appearance.primaryColor")}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    className="h-10 w-16 cursor-pointer p-1"
                    value={settings.widget.primaryColor}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        widget: {
                          ...prev.widget,
                          primaryColor: event.target.value,
                        },
                      }))
                    }
                  />
                  <Input
                    value={settings.widget.primaryColor}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        widget: {
                          ...prev.widget,
                          primaryColor: event.target.value,
                        },
                      }))
                    }
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("widget.appearance.accentColor")}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    className="h-10 w-16 cursor-pointer p-1"
                    value={settings.widget.accentColor}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        widget: {
                          ...prev.widget,
                          accentColor: event.target.value,
                        },
                      }))
                    }
                  />
                  <Input
                    value={settings.widget.accentColor}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        widget: {
                          ...prev.widget,
                          accentColor: event.target.value,
                        },
                      }))
                    }
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("widget.appearance.footerText")}</Label>
              <Input
                value={settings.widget.footerText || ""}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    widget: {
                      ...prev.widget,
                      footerText: event.target.value,
                    },
                  }))
                }
                placeholder={t("widget.appearance.footerTextPlaceholder")}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label>{t("widget.appearance.showFooterText")}</Label>
                <p className="text-sm text-muted-foreground">
                  {t("widget.appearance.showFooterTextDescription")}
                </p>
              </div>
              <Switch
                checked={settings.widget.showFooterText}
                onCheckedChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    widget: { ...prev.widget, showFooterText: value },
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>{t("widget.appearance.headerAvatar")}</Label>
              <MediaUploader
                value={
                  settings.widget.avatarUrl
                    ? [
                        {
                          _id: "ai-sales-avatar",
                          url: settings.widget.avatarUrl,
                          type: "image",
                          mimeType: "image/*",
                          alt: t("widget.appearance.headerAvatarAlt", {
                            name: settings.agentName,
                          }),
                          position: 0,
                        },
                      ]
                    : []
                }
                onChange={(items) => {
                  const avatar = items.find(
                    (item) => item.type === "image",
                  );
                  setSettings((prev) => ({
                    ...prev,
                    widget: {
                      ...prev.widget,
                      avatarUrl: avatar?.url || "",
                    },
                  }));
                }}
                maxFiles={1}
                acceptTypes={["image"]}
                uploadTitle={t("widget.appearance.avatarUploadTitle")}
                uploadDescription={t(
                  "widget.appearance.avatarUploadDescription",
                )}
                sizeGuide={t("widget.appearance.avatarSizeGuide")}
                mediaGridClassName="grid-cols-1 md:grid-cols-1 max-w-40"
                previewAspectRatio="1 / 1"
                previewFit="cover"
                showCoverBadge={false}
                coverHint={false}
              />
              <p className="text-xs text-muted-foreground">
                {t("widget.appearance.headerAvatarDescription")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden gap-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4" />
              {t("widget.preview.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center rounded-xl bg-muted/40 p-4">
              <div
                className="flex flex-col overflow-hidden rounded-[32px] border bg-background text-foreground shadow-sm"
                style={{
                  width: `min(${settings.widget.width}px, 100%)`,
                  height: `${Math.max(settings.widget.height, 0)}px`,
                  maxHeight: "70vh",
                }}
              >
                <div className="relative px-4 pt-4">
                  <div
                    className="flex h-12 items-center justify-between rounded-full px-5 text-white"
                    style={{
                      background: `linear-gradient(135deg, ${settings.widget.primaryColor}, ${settings.widget.accentColor})`,
                    }}
                  >
                    <span className="text-sm font-semibold tracking-wide">
                      {settings.widget.headerTitle?.trim() ||
                        settings.agentName}
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                      <Plus className="h-4 w-4 rotate-45" />
                    </span>
                  </div>
                  <div className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2">
                    <AISalesHeaderIcon
                      avatarUrl={settings.widget.avatarUrl}
                      faviconUrl={faviconUrl}
                      primaryColor={settings.widget.primaryColor}
                      accentColor={settings.widget.accentColor}
                      agentName={settings.agentName}
                    />
                  </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-10">
                  <div className="flex gap-2">
                    <AISalesAssistantAvatar
                      primaryColor={settings.widget.primaryColor}
                    />
                    <div className="w-fit max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                      {settings.greeting}
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4">
                  <div
                    className="flex items-center gap-2 rounded-full border-2 bg-card py-1.5 pl-4 pr-1.5 text-foreground"
                    style={{ borderColor: settings.widget.primaryColor }}
                  >
                    <span className="flex h-9 flex-1 items-center text-sm text-muted-foreground">
                      {t("widget.preview.typeMessage")}
                    </span>
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                      style={{
                        backgroundColor: settings.widget.primaryColor,
                      }}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </span>
                  </div>
                  {settings.widget.showFooterText &&
                    settings.widget.footerText && (
                      <p className="mt-2 text-center text-[11px] text-muted-foreground">
                        {settings.widget.footerText}
                      </p>
                    )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
