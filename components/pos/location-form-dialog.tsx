"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { coordinatesFromMapsUrl } from "@/lib/locations/maps-url";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type OpeningHours = {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
};

const WEEKDAYS = Array.from({ length: 7 }, (_, weekday) =>
  new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" })
    // 2024-01-07 was a Sunday, matching the stored 0 = Sunday indexing.
    .format(new Date(Date.UTC(2024, 0, 7 + weekday))),
);

const DEFAULT_HOURS: OpeningHours[] = WEEKDAYS.map((_, weekday) => ({
  weekday,
  enabled: weekday >= 1 && weekday <= 5,
  start: "09:00",
  end: "18:00",
}));

interface Location {
  _id: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
  pickupEnabled?: boolean;
  fulfillsOnlineOrders?: boolean;
  sellsAtCounter?: boolean;
  pickupArea?: string;
  instructions?: string;
  weeklyHours?: OpeningHours[];
  mapsUrl?: string;
}

interface LocationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: Location | null;
  onSuccess: () => void;
}

export function LocationFormDialog({
  open,
  onOpenChange,
  location,
  onSuccess,
}: LocationFormDialogProps) {
  const t = useTranslations();
  const isEditing = Boolean(location);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(false);
  // On by default. Every location already fed online orders before this flag
  // existed — the decrement simply took from wherever the units were — so a new
  // branch that opted out by default would change dispatch behaviour for a
  // merchant who never touched the setting.
  const [fulfillsOnlineOrders, setFulfillsOnlineOrders] = useState(true);
  // On by default for the same reason, and one more: the list this gates is
  // only ever shown to the merchant's own staff, so it is not a disclosure the
  // way publishing a pickup address is.
  const [sellsAtCounter, setSellsAtCounter] = useState(true);
  const [pickupArea, setPickupArea] = useState("");
  const [instructions, setInstructions] = useState("");
  const [weeklyHours, setWeeklyHours] = useState<OpeningHours[]>(DEFAULT_HOURS);
  const [mapsUrl, setMapsUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const pastedPoint = coordinatesFromMapsUrl(mapsUrl);

  // Reset form when dialog opens/closes or location changes
  useApplyOnChange([open, location], () => {
    if (open && location) {
      setName(location.name);
      setAddress(location.address || "");
      setIsDefault(location.isDefault);
      setIsActive(location.isActive);
      setPickupEnabled(Boolean(location.pickupEnabled));
      // `!== false`, not `Boolean(...)`: a branch saved before this field
      // existed has it undefined, and reading that as "off" would drop it out
      // of the dispatch order the first time anyone opened its form.
      setFulfillsOnlineOrders(location.fulfillsOnlineOrders !== false);
      setSellsAtCounter(location.sellsAtCounter !== false);
      setPickupArea(location.pickupArea || "");
      setInstructions(location.instructions || "");
      setWeeklyHours(
        location.weeklyHours?.length ? location.weeklyHours : DEFAULT_HOURS,
      );
      setMapsUrl(location.mapsUrl || "");
    } else if (open && !location) {
      setName("");
      setAddress("");
      setIsDefault(false);
      setIsActive(true);
      // Every field, not just the first four: reusing this dialog for "add"
      // right after editing a collection point would otherwise carry that
      // branch's hours and instructions into a brand new one.
      setPickupEnabled(false);
      setFulfillsOnlineOrders(true);
      setSellsAtCounter(true);
      setPickupArea("");
      setInstructions("");
      setWeeklyHours(DEFAULT_HOURS);
      setMapsUrl("");
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(t("locations.nameRequired"));
      return;
    }

    // A collection point with no address is a shop nobody can be sent to, and
    // checkout drops it silently — so it would appear in "pickup near me" and
    // then offer no pickup. The server refuses it too; this is just the half
    // that can say so before the round trip.
    if (pickupEnabled && !address.trim()) {
      toast.error(
        "Add the address customers should collect from, or turn off collection",
      );
      return;
    }

    setIsSaving(true);

    try {
      const url = isEditing
        ? `/api/admin/locations/${location!._id}`
        : "/api/admin/locations";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          isDefault,
          pickupEnabled,
          fulfillsOnlineOrders,
          sellsAtCounter,
          // Only meaningful for a place the public may walk into; sending them
          // regardless would leave a warehouse carrying collection copy.
          ...(pickupEnabled
            ? {
                pickupArea: pickupArea.trim(),
                instructions: instructions.trim(),
                weeklyHours,
                mapsUrl: mapsUrl.trim(),
              }
            : {}),
          ...(isEditing && { isActive }),
        }),
      });

      const json = await res.json();

      if (json.success) {
        toast.success(
          isEditing ? t("locations.updated") : t("locations.created")
        );
        onSuccess();
      } else {
        toast.error(json.message || t("locations.saveError"));
      }
    } catch {
      toast.error(t("locations.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-visible max-h-[85dvh] overflow-y-auto sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? t("locations.editLocation")
                : t("locations.addLocation")}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? t("locations.editDescription")
                : t("locations.addDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="location-name">{t("locations.name")}</Label>
              <Input
                id="location-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("locations.namePlaceholder")}
                autoFocus
              />
            </div>

            {/* Address */}
            <div className="grid gap-2">
              <Label htmlFor="location-address">
                {t("locations.address")}
                {pickupEnabled ? (
                  <span className="ml-1 text-destructive">*</span>
                ) : null}
              </Label>
              <Textarea
                id="location-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("locations.addressPlaceholder")}
                rows={3}
              />
            </div>

            {/* Collection */}
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label
                    htmlFor="location-pickup"
                    className="text-sm font-medium"
                  >
                    Customers can collect here
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off for a warehouse. On for a shop the public can walk into.
                  </p>
                </div>
                <Switch
                  id="location-pickup"
                  checked={pickupEnabled}
                  onCheckedChange={setPickupEnabled}
                />
              </div>

              {/* The other half of the same question. Collection and dispatch
                  are genuinely independent — a shop floor does both, a
                  warehouse only posts, a market stall only hands over — so
                  deriving one from the other would misdescribe every store
                  that is not the simplest kind. */}
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label
                    htmlFor="location-fulfills-online"
                    className="text-sm font-medium"
                  >
                    Ship online orders from here
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off for a counter that only hands over what is brought to
                    it. Delivery orders draw stock from the first branch in your
                    list that has it.
                  </p>
                </div>
                <Switch
                  id="location-fulfills-online"
                  checked={fulfillsOnlineOrders}
                  onCheckedChange={setFulfillsOnlineOrders}
                />
              </div>

              {/* The third capability, and the only one that answers this: a
                  collection point admits the public and rings nothing up, a shop
                  floor with collection off still has a till, and "ships online
                  orders" is on almost everywhere so it says nothing either. */}
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label
                    htmlFor="location-sells-at-counter"
                    className="text-sm font-medium"
                  >
                    Sell over a counter here
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off for a warehouse or a collection point with no till. Only
                    places with this on are offered to a cashier opening the
                    register.
                  </p>
                </div>
                <Switch
                  id="location-sells-at-counter"
                  checked={sellsAtCounter}
                  onCheckedChange={setSellsAtCounter}
                />
              </div>

              {pickupEnabled ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid gap-2">
                    <Label htmlFor="location-pickup-area">
                      Area shown before checkout
                    </Label>
                    <Input
                      id="location-pickup-area"
                      value={pickupArea}
                      onChange={(e) => setPickupArea(e.target.value)}
                      placeholder="e.g. Gulshan, Dhaka"
                      maxLength={160}
                    />
                    {/* The exact address is withheld until an order exists, so
                        shoppers browsing see only the neighbourhood. */}
                    <p className="text-xs text-muted-foreground">
                      The full address above is only revealed once an order is
                      placed.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="location-maps-url">
                      Map link (optional)
                    </Label>
                    <Input
                      id="location-maps-url"
                      value={mapsUrl}
                      onChange={(e) => setMapsUrl(e.target.value)}
                      placeholder="Paste a Google Maps link to this shop"
                      maxLength={500}
                    />
                    {/* Parsed as they type, with the same function the server
                        uses. A link that silently failed to parse would mean a
                        shop that never appears in "near me" — and nothing on
                        the storefront would explain why. */}
                    {mapsUrl.trim() ? (
                      pastedPoint ? (
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">
                          Pin found: {pastedPoint.lat.toFixed(4)},{" "}
                          {pastedPoint.lng.toFixed(4)}
                        </p>
                      ) : (
                        <p className="text-xs text-destructive">
                          No coordinates in that link. Open the shop in Google
                          Maps and copy the URL from the address bar.
                        </p>
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Leave empty to use your store address. Set this if the
                        counter is somewhere else — it is what &ldquo;near
                        me&rdquo; measures from.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="location-pickup-instructions">
                      Collection instructions
                    </Label>
                    <Textarea
                      id="location-pickup-instructions"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="e.g. Ask for Amina at the side entrance"
                      maxLength={1000}
                      rows={2}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Opening hours</Label>
                    {/* Guidance, not a booking system: shoppers turn up while
                        you are open, so nothing is validated against these. */}
                    <div className="space-y-1.5">
                      {weeklyHours.map((hours) => (
                        <div
                          key={hours.weekday}
                          className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2"
                        >
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={hours.enabled}
                              onChange={(e) =>
                                setWeeklyHours((current) =>
                                  current.map((item) =>
                                    item.weekday === hours.weekday
                                      ? { ...item, enabled: e.target.checked }
                                      : item,
                                  ),
                                )
                              }
                            />
                            {WEEKDAYS[hours.weekday]}
                          </label>
                          <Input
                            type="time"
                            value={hours.start}
                            disabled={!hours.enabled}
                            onChange={(e) =>
                              setWeeklyHours((current) =>
                                current.map((item) =>
                                  item.weekday === hours.weekday
                                    ? { ...item, start: e.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                          <Input
                            type="time"
                            value={hours.end}
                            disabled={!hours.enabled}
                            onChange={(e) =>
                              setWeeklyHours((current) =>
                                current.map((item) =>
                                  item.weekday === hours.weekday
                                    ? { ...item, end: e.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Default toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="location-default" className="text-sm font-medium">
                  {t("locations.defaultLocation")}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("locations.defaultHint")}
                </p>
              </div>
              <Switch
                id="location-default"
                checked={isDefault}
                onCheckedChange={setIsDefault}
              />
            </div>

            {/* Active toggle (only for editing) */}
            {isEditing && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="location-active" className="text-sm font-medium">
                    {t("locations.activeLocation")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("locations.activeHint")}
                  </p>
                </div>
                <Switch
                  id="location-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? t("common.save") : t("locations.addLocation")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
