"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  SettingList,
  SettingRow,
  SettingUnit,
} from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";

/**
 * Settings → Shipping & Delivery → Customs & duties. Off, the card is its
 * title and switch; on, it asks who pays the duty, and only when the store
 * collects it (DDP) the rate and the duty-free amount — which used to sit on
 * the page greyed out for every store that never ships abroad.
 */
export function CustomsCard(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping.customs");
  const customs = props.settings.shipping.customs;
  const enabled = Boolean(customs?.enabled);
  const dutyMode = customs?.dutyMode === "DDP" ? "DDP" : "DDU";
  const currency = props.settings.general.defaultCurrency || "USD";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <Switch
            checked={enabled}
            aria-label={t("title")}
            onCheckedChange={(checked) =>
              props.updateField("shipping.customs.enabled", checked)
            }
          />
        </CardAction>
      </CardHeader>
      {enabled ? (
        <CardContent>
          <SettingList>
            <SettingRow
              inputId="customsDutyMode"
              label={t("dutyMode")}
              hint={dutyMode === "DDP" ? t("dutyModeHintDdp") : t("dutyModeHintDdu")}
            >
              <Select
                value={dutyMode}
                onValueChange={(value) => props.updateField("shipping.customs.dutyMode", value)}
              >
                <SelectTrigger id="customsDutyMode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DDU">{t("ddu")}</SelectItem>
                  <SelectItem value="DDP">{t("ddp")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            {dutyMode === "DDP" ? (
              <>
                <SettingRow
                  inputId="customsDutyRate"
                  label={t("dutyRatePercent")}
                  hint={t("dutyRateHint")}
                >
                  <NumberInput
                    id="customsDutyRate"
                    className="w-24"
                    min={0}
                    max={100}
                    value={customs?.dutyRatePercent ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) =>
                      props.updateField("shipping.customs.dutyRatePercent", next ?? 0)
                    }
                  />
                  <SettingUnit>%</SettingUnit>
                </SettingRow>
                <SettingRow
                  inputId="customsDeMinimis"
                  label={t("deMinimis")}
                  hint={t("deMinimisHint")}
                >
                  <NumberInput
                    id="customsDeMinimis"
                    className="w-24"
                    min={0}
                    value={customs?.deMinimis ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) =>
                      props.updateField("shipping.customs.deMinimis", next ?? 0)
                    }
                  />
                  <SettingUnit>{currency}</SettingUnit>
                </SettingRow>
              </>
            ) : null}
          </SettingList>
        </CardContent>
      ) : null}
    </Card>
  );
}
