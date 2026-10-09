"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeatureGroup } from "@/components/admin/settings/fields/feature-row";
import { BUILT_IN_TRACKING_COURIERS } from "@/lib/shipping/tracking-urls";
import type { Settings } from "@/components/admin/settings/types";

type CourierLink = NonNullable<
  Settings["shipping"]["courierTrackingLinks"]
>[number];

/**
 * Where a hand-entered AWB points.
 *
 * A parcel booked through Shippo or Shiprocket arrives with the carrier's own
 * tracking page attached. One typed in by hand does not, so the number reached
 * the customer as text they could do nothing with. A short built-in list
 * covers the couriers named here; this is how a merchant covers the one they
 * actually use — and overrides ours when their lane runs through a local
 * agent whose tracking lives somewhere else entirely.
 *
 * It shows whether or not a carrier account is connected: a store with none
 * enters every tracking number by hand.
 */
export function CourierLinksSection(props: {
  links: CourierLink[];
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping.courierLinks");
  const { links } = props;

  const write = (next: CourierLink[]) =>
    props.updateField("shipping.courierTrackingLinks", next);

  const patch = (index: number, changes: Partial<CourierLink>) =>
    write(links.map((link, i) => (i === index ? { ...link, ...changes } : link)));

  return (
    <FeatureGroup title={t("title")}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1 basis-72 space-y-0.5">
          <p className="text-sm font-medium">{t("heading")}</p>
          <p className="text-muted-foreground text-sm">
            {t("builtIn", { couriers: BUILT_IN_TRACKING_COURIERS.join(", ") })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => write([...links, { carrier: "", urlTemplate: "" }])}
        >
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      {links.map((link, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 p-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
        >
          <div className="col-span-2 min-w-0 space-y-1.5 @xl:col-span-1">
            <label htmlFor={`courier-name-${index}`} className="text-sm font-medium">
              {t("carrier")}
            </label>
            <Input
              id={`courier-name-${index}`}
              value={link.carrier}
              placeholder="Pathao"
              onChange={(event) => patch(index, { carrier: event.target.value })}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={`courier-url-${index}`} className="text-sm font-medium">
              {t("urlTemplate")}
            </label>
            <Input
              id={`courier-url-${index}`}
              value={link.urlTemplate}
              placeholder="https://courier.example/track?id={tracking}"
              onChange={(event) => patch(index, { urlTemplate: event.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => write(links.filter((_, i) => i !== index))}
            aria-label={t("remove")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {links.length > 0 ? (
        <p className="text-muted-foreground p-4 text-xs">
          {
            // The sentence names the placeholder itself, and to the message
            // format `{tracking}` is an argument: unfilled, the page showed
            // the message key instead of the sentence.
            t("description", { tracking: "{tracking}" })
          }
        </p>
      ) : null}
    </FeatureGroup>
  );
}
