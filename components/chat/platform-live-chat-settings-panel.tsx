"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Loader2, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface BusinessHour {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

interface MessagingSettings {
  liveChatEnabled: boolean;
  availabilityMode: "always" | "business_hours";
  timezone: string;
  businessHours: BusinessHour[];
  primaryColor: string;
  offlineMessage: string;
  escalationEnabled: boolean;
  escalationAfterMinutes: number;
  escalationEmail: string;
}

/** 2024-01-07 (UTC) is a Sunday, so day index 0..6 maps to Sunday..Saturday. */
const FIRST_SUNDAY_UTC_DATE = 7;

export function PlatformLiveChatSettingsPanel() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const tr = useFallbackTranslator(t);

  const dayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone: "UTC",
    });
    return Array.from({ length: 7 }, (_, day) =>
      formatter.format(
        new Date(Date.UTC(2024, 0, FIRST_SUNDAY_UTC_DATE + day)),
      ),
    );
  }, [locale]);

  const [settings, setSettings] = useState<MessagingSettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadFailedMessage = tr(
    "liveChatSettings.loadFailed",
    "Unable to load live-chat settings",
  );
  const saveFailedMessage = tr(
    "liveChatSettings.saveFailed",
    "Unable to save live-chat settings",
  );

  useEffect(() => {
    void fetch("/api/admin/messaging/settings")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || loadFailedMessage);
        }
        setSettings(payload.data);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : loadFailedMessage),
      )
      .finally(() => setLoading(false));
  }, [loadFailedMessage]);

  const updateHour = (day: number, update: Partial<BusinessHour>) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            businessHours: current.businessHours.map((entry) =>
              entry.day === day ? { ...entry, ...update } : entry,
            ),
          }
        : current,
    );
  };

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/messaging/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || saveFailedMessage);
      }
      setSettings(payload.data);
      toast.success(tr("liveChatSettings.saved", "Live-chat settings saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : saveFailedMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="size-5" />
          {tr("liveChatSettings.title", "Platform live chat")}
        </CardTitle>
        <CardDescription>
          {tr(
            "liveChatSettings.description",
            "Set availability, storefront appearance, and unanswered-chat email escalation.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading || !settings ? (
          <div className="grid min-h-32 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <Label>{tr("liveChatSettings.enable", "Enable live chat")}</Label>
                <p className="text-xs text-muted-foreground">
                  {tr("liveChatSettings.enableHint", "Show live chat for marketplace-owned products.")}
                </p>
              </div>
              <Switch
                checked={settings.liveChatEnabled}
                onCheckedChange={(liveChatEnabled) =>
                  setSettings({ ...settings, liveChatEnabled })
                }
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{tr("liveChatSettings.availability", "Availability")}</Label>
                <Select
                  value={settings.availabilityMode}
                  onValueChange={(availabilityMode) =>
                    setSettings({
                      ...settings,
                      availabilityMode: availabilityMode as
                        | "always"
                        | "business_hours",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">
                      {tr("liveChatSettings.alwaysOnline", "Always online")}
                    </SelectItem>
                    <SelectItem value="business_hours">
                      {tr("liveChatSettings.businessHoursOption", "Business hours")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-timezone">
                  {tr("liveChatSettings.timezone", "Timezone")}
                </Label>
                <Input
                  id="chat-timezone"
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings({ ...settings, timezone: event.target.value })
                  }
                  placeholder="Asia/Dhaka"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-color">
                  {tr("liveChatSettings.primaryColor", "Primary color")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="w-14 p-1"
                    value={settings.primaryColor}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        primaryColor: event.target.value,
                      })
                    }
                  />
                  <Input
                    id="chat-color"
                    value={settings.primaryColor}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        primaryColor: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {settings.availabilityMode === "business_hours" ? (
              <div className="space-y-2 rounded-lg border p-4">
                <Label>{tr("liveChatSettings.weeklySchedule", "Weekly schedule")}</Label>
                {settings.businessHours
                  .slice()
                  .sort((a, b) => a.day - b.day)
                  .map((entry) => (
                    <div
                      key={entry.day}
                      className="grid grid-cols-[110px_1fr_1fr_auto] items-center gap-2"
                    >
                      <span className="text-sm">{dayNames[entry.day]}</span>
                      <Input
                        type="time"
                        value={entry.start}
                        disabled={!entry.enabled}
                        onChange={(event) =>
                          updateHour(entry.day, { start: event.target.value })
                        }
                      />
                      <Input
                        type="time"
                        value={entry.end}
                        disabled={!entry.enabled}
                        onChange={(event) =>
                          updateHour(entry.day, { end: event.target.value })
                        }
                      />
                      <Switch
                        checked={entry.enabled}
                        onCheckedChange={(enabled) =>
                          updateHour(entry.day, { enabled })
                        }
                      />
                    </div>
                  ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="offline-message">
                {tr("liveChatSettings.offlineMessage", "Offline message")}
              </Label>
              <Textarea
                id="offline-message"
                maxLength={500}
                value={settings.offlineMessage}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    offlineMessage: event.target.value,
                  })
                }
              />
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>{tr("liveChatSettings.emailEscalation", "Email escalation")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "liveChatSettings.emailEscalationHint",
                      "Email the responsible store when an inbound message remains unanswered.",
                    )}
                  </p>
                </div>
                <Switch
                  checked={settings.escalationEnabled}
                  onCheckedChange={(escalationEnabled) =>
                    setSettings({ ...settings, escalationEnabled })
                  }
                />
              </div>
              {settings.escalationEnabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="escalation-minutes">
                      {tr("liveChatSettings.escalateAfter", "Escalate after (minutes)")}
                    </Label>
                    <NumberInput
                      id="escalation-minutes"
                      min={5}
                      max={1440}
                      step={1}
                      value={settings.escalationAfterMinutes}
                      whenEmpty="keep"
                      normalize={Math.trunc}
                      onValueChange={(next) => {
                        if (next === undefined) return;
                        setSettings({ ...settings, escalationAfterMinutes: next });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="escalation-email">
                      {tr("liveChatSettings.fallbackEmail", "Platform fallback email")}
                    </Label>
                    <Input
                      id="escalation-email"
                      type="email"
                      value={settings.escalationEmail}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          escalationEmail: event.target.value,
                        })
                      }
                      placeholder="support@example.com"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {tr("liveChatSettings.save", "Save live-chat settings")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
