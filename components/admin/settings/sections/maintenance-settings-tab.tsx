"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Settings } from "@/components/admin/settings/types";
import { normalizeAllowedIPs } from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import { ImageUploadField } from "@/components/admin/settings/fields/image-upload-field";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

function toDateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function MaintenanceSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const { settings, isSaving, isDirty, updateNestedField, onSave } = props;
  const maintenance = settings.maintenance || { enabled: false };
  const translate = useFallbackTranslator(t);
  const countdownDate = maintenance.countdownEndsAt
    ? new Date(maintenance.countdownEndsAt)
    : null;
  const countdownEndsAt =
    countdownDate && Number.isFinite(countdownDate.getTime())
      ? format(countdownDate, "PPP p")
      : null;
  const backgroundImageUrl = maintenance.backgroundImageUrl?.trim() || "";

  return (
    <div className="space-y-4 pb-24">
      <SettingsTabHeader
        title={t("admin.settings.maintenance.title")}
        description={t("admin.settings.maintenance.description")}
      />
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <h4 className="font-medium">
                {t("admin.settings.maintenance.enable")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.settings.maintenance.enableDesc")}
              </p>
            </div>
            <Switch
              checked={maintenance.enabled}
              onCheckedChange={(value) =>
                updateNestedField("maintenance.enabled", value)
              }
            />
          </div>

          {maintenance.enabled ? (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="maintenanceTitle">
                      {translate(
                        "admin.settings.maintenance.titleLabel",
                        "Headline",
                      )}
                    </Label>
                    <Input
                      id="maintenanceTitle"
                      value={maintenance.title || ""}
                      placeholder={translate(
                        "admin.settings.maintenance.titlePlaceholder",
                        "We'll be back soon",
                      )}
                      onChange={(event) =>
                        updateNestedField(
                          "maintenance.title",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maintenanceMessage">
                      {t("admin.settings.maintenance.message")}
                    </Label>
                    <Textarea
                      id="maintenanceMessage"
                      value={maintenance.message || ""}
                      onChange={(event) =>
                        updateNestedField(
                          "maintenance.message",
                          event.target.value,
                        )
                      }
                      placeholder={t(
                        "admin.settings.maintenance.messagePlaceholder",
                      )}
                      rows={5}
                    />
                  </div>

                  <ImageUploadField
                    id="maintenanceBackgroundImageUrl"
                    label={translate(
                      "admin.settings.maintenance.backgroundImage",
                      "Background image",
                    )}
                    value={maintenance.backgroundImageUrl || ""}
                    onChange={(value) =>
                      updateNestedField("maintenance.backgroundImageUrl", value)
                    }
                    previewAlt={translate(
                      "admin.settings.maintenance.backgroundImagePreviewAlt",
                      "Maintenance background preview",
                    )}
                    previewClassName="h-full w-full object-cover"
                  />
                  <p className="-mt-3 text-sm text-muted-foreground">
                    {translate(
                      "admin.settings.maintenance.backgroundImageHint",
                      "When an image is set, visitors see it dimmed behind the maintenance text without the card.",
                    )}
                  </p>

                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h4 className="font-medium">
                          {translate(
                            "admin.settings.maintenance.countdown",
                            "Show countdown",
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {translate(
                            "admin.settings.maintenance.countdownDesc",
                            "Display a live countdown until the store is expected back online.",
                          )}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(maintenance.countdownEnabled)}
                        onCheckedChange={(value) =>
                          updateNestedField(
                            "maintenance.countdownEnabled",
                            value,
                          )
                        }
                      />
                    </div>

                    {maintenance.countdownEnabled ? (
                      <div className="space-y-2">
                        <Label htmlFor="maintenanceCountdownEndsAt">
                          {translate(
                            "admin.settings.maintenance.countdownEndsAt",
                            "Expected back online",
                          )}
                        </Label>
                        <Input
                          id="maintenanceCountdownEndsAt"
                          type="datetime-local"
                          value={toDateTimeLocalValue(
                            maintenance.countdownEndsAt,
                          )}
                          onChange={(event) =>
                            updateNestedField(
                              "maintenance.countdownEndsAt",
                              toIsoDateTime(event.target.value),
                            )
                          }
                        />
                        <p className="text-sm text-muted-foreground">
                          {translate(
                            "admin.settings.maintenance.countdownEndsAtHint",
                            "Set the local date and time customers should count down to.",
                          )}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maintenanceAllowedIps">
                      {translate(
                        "admin.settings.maintenance.allowedIPs",
                        "Allowlisted IP addresses",
                      )}
                    </Label>
                    <Textarea
                      id="maintenanceAllowedIps"
                      value={(maintenance.allowedIPs || []).join("\n")}
                      onChange={(event) =>
                        updateNestedField(
                          "maintenance.allowedIPs",
                          normalizeAllowedIPs(
                            event.target.value
                              .split(/\r?\n|,/)
                              .map((value) => value.trim()),
                          ),
                        )
                      }
                      placeholder={"203.0.113.10\n198.51.100.24"}
                      rows={4}
                    />
                    <p className="text-sm text-muted-foreground">
                      {translate(
                        "admin.settings.maintenance.allowedIPsHint",
                        "One IP per line. These visitors can still access the storefront while maintenance mode is enabled.",
                      )}
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "relative overflow-hidden rounded-xl border p-5",
                    backgroundImageUrl
                      ? "min-h-[360px] border-transparent bg-slate-950 text-white"
                      : "bg-muted/30",
                  )}
                >
                  {backgroundImageUrl ? (
                    <>
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-55"
                        style={{
                          backgroundImage: `url(${JSON.stringify(backgroundImageUrl)})`,
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/25 to-slate-950/65" />
                    </>
                  ) : null}
                  <div className="relative">
                  <p
                    className={cn(
                      "text-xs font-semibold uppercase tracking-normal",
                      backgroundImageUrl ? "text-white/80" : "text-primary",
                    )}
                  >
                    Live Preview
                  </p>
                  <div className="mt-4 space-y-4">
                    <div
                      className={cn(
                        "inline-flex rounded-full border px-3 py-1 text-xs font-medium",
                        backgroundImageUrl
                          ? "border-white/25 bg-white/10 text-white"
                          : "border-primary/15 bg-primary/10 text-primary",
                      )}
                    >
                      Scheduled maintenance
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-semibold leading-tight">
                        {maintenance.title?.trim() || "We'll be back soon"}
                      </h3>
                      <p
                        className={cn(
                          "text-sm leading-6",
                          backgroundImageUrl
                            ? "text-white/85"
                            : "text-muted-foreground",
                        )}
                      >
                        {maintenance.message?.trim() ||
                          "We're making a few improvements behind the scenes. Thanks for your patience."}
                      </p>
                    </div>

                    {maintenance.countdownEnabled ? (
                      <div
                        className={cn(
                          "rounded-lg border p-4",
                          backgroundImageUrl
                            ? "border-white/20 bg-white/10 backdrop-blur-sm"
                            : "bg-background",
                        )}
                      >
                        <p className="text-sm font-medium">Expected back</p>
                        <p
                          className={cn(
                            "mt-2 text-sm",
                            backgroundImageUrl
                              ? "text-white/75"
                              : "text-muted-foreground",
                          )}
                        >
                          {countdownEndsAt || "Choose a return time to start the countdown."}
                        </p>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "rounded-lg border border-dashed p-4 text-sm",
                          backgroundImageUrl
                            ? "border-white/20 bg-white/10 text-white/70"
                            : "bg-background/70 text-muted-foreground",
                        )}
                      >
                        Countdown is hidden. Visitors will only see the title and message.
                      </div>
                    )}

                    {(maintenance.allowedIPs || []).length > 0 ? (
                      <div
                        className={cn(
                          "rounded-lg border p-4",
                          backgroundImageUrl
                            ? "border-white/20 bg-white/10 backdrop-blur-sm"
                            : "bg-background",
                        )}
                      >
                        <p className="text-sm font-medium">Access bypass</p>
                        <p
                          className={cn(
                            "mt-2 text-sm",
                            backgroundImageUrl
                              ? "text-white/75"
                              : "text-muted-foreground",
                          )}
                        >
                          {maintenance.allowedIPs?.length} IP
                          {maintenance.allowedIPs?.length === 1 ? "" : "s"} can
                          still access the storefront.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <StickySaveFooter
            label={t("admin.settings.maintenance.save")}
            isSaving={isSaving}
            isDirty={isDirty}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
