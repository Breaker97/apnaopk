"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUILT_IN_TRACKING_COURIERS } from "@/lib/shipping/tracking-urls";
import type { Settings } from "@/components/admin/settings/types";

type CourierLink = NonNullable<
  Settings["shipping"]["courierTrackingLinks"]
>[number];
type TSafe = (key: string, fallback: string) => string;

/**
 * Where a hand-entered AWB points.
 *
 * A parcel booked through Shippo or Shiprocket arrives with the carrier's own
 * tracking page attached. One typed in by hand does not, so the number reached
 * the customer as text they could do nothing with. A short built-in list
 * covers the couriers named below; this is how a merchant covers the one they
 * actually use — and overrides ours when their lane runs through a local
 * agent whose tracking lives somewhere else entirely.
 */
export function CourierLinksCard(props: {
  links: CourierLink[];
  tSafe: TSafe;
  updateField: (path: string, value: unknown) => void;
}) {
  const { links, tSafe, updateField } = props;

  const write = (next: CourierLink[]) =>
    updateField("shipping.courierTrackingLinks", next);

  const patch = (index: number, changes: Partial<CourierLink>) =>
    write(links.map((link, i) => (i === index ? { ...link, ...changes } : link)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tSafe(
            "admin.settings.shipping.courierLinks.title",
            "Courier tracking links",
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {tSafe(
            "admin.settings.shipping.courierLinks.description",
            "For parcels you enter by hand. Use {tracking} where the tracking number goes; a link with no placeholder gets it appended.",
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.settings.shipping.courierLinks.builtIn",
              "Already linked without any setup:",
            )}{" "}
            {BUILT_IN_TRACKING_COURIERS.join(", ")}.
          </p>
        ) : null}

        {links.map((link, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
          >
            <div className="space-y-1">
              <Label htmlFor={`courier-name-${index}`}>
                {tSafe(
                  "admin.settings.shipping.courierLinks.carrier",
                  "Courier name",
                )}
              </Label>
              <Input
                id={`courier-name-${index}`}
                value={link.carrier}
                placeholder="Pathao"
                onChange={(event) =>
                  patch(index, { carrier: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`courier-url-${index}`}>
                {tSafe(
                  "admin.settings.shipping.courierLinks.urlTemplate",
                  "Tracking URL",
                )}
              </Label>
              <Input
                id={`courier-url-${index}`}
                value={link.urlTemplate}
                placeholder="https://courier.example/track?id={tracking}"
                onChange={(event) =>
                  patch(index, { urlTemplate: event.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => write(links.filter((_, i) => i !== index))}
                aria-label={tSafe(
                  "admin.settings.shipping.courierLinks.remove",
                  "Remove courier link",
                )}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => write([...links, { carrier: "", urlTemplate: "" }])}
        >
          <Plus className="h-4 w-4" />
          {tSafe("admin.settings.shipping.courierLinks.add", "Add courier")}
        </Button>
      </CardContent>
    </Card>
  );
}
