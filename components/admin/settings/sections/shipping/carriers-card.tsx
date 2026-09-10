"use client";

import { useState } from "react";
import {
  Loader2,
  RefreshCw,
  ShieldAlert,
  TestTube,
  Unplug,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import {
  ModeBadge,
  ProviderCard,
  StatusBadge,
} from "@/components/admin/settings/fields/provider-card";
import type {
  CarrierAuthFailure,
  Settings,
} from "@/components/admin/settings/types";
import {
  CARRIER_PROVIDER_LABELS,
  carrierSupportsOrigin,
  shippoOriginHint,
  type CarrierProvider,
} from "@/lib/shipping/carrier-config";
import { ShippoLogo, ShiprocketLogo } from "./carrier-brand-logos";
import { useClientValue } from "@/hooks/use-client-value";

type TSafe = (key: string, fallback: string) => string;

/**
 * The carrier is refusing our credentials.
 *
 * Loud on purpose, and above the fields rather than beside a badge: while this
 * is showing, every parcel queued for this carrier dead-letters on its first
 * attempt. Nothing else on the screen would say so — the carrier still reads as
 * connected, because a stored token looks identical whether or not it still
 * works.
 */
function AuthFailureNotice(props: {
  failure: CarrierAuthFailure;
  tSafe: TSafe;
}) {
  const when = new Date(props.failure.at);
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="space-y-1 text-xs">
        <p className="font-medium text-destructive">
          {props.tSafe(
            "admin.settings.shipping.carriers.authFailed",
            "This carrier is rejecting your credentials — nothing can ship on it.",
          )}
        </p>
        {props.failure.message ? (
          <p className="text-muted-foreground">{props.failure.message}</p>
        ) : null}
        <p className="text-muted-foreground">
          {props.tSafe(
            "admin.settings.shipping.carriers.authFailedHint",
            "Update the credentials below, then press Test connection. The warning clears itself once the carrier accepts them.",
          )}
          {Number.isFinite(when.getTime())
            ? ` (${when.toLocaleString()})`
            : ""}
        </p>
      </div>
    </div>
  );
}

/** Shown so an operator can copy the URL into the carrier's own dashboard. */
function WebhookUrlRow(props: { label: string; url: string }) {
  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <Input readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

export function CarriersCard(props: {
  settings: Settings;
  tSafe: TSafe;
  isBusy: boolean;
  updateField: (path: string, value: unknown) => void;
  onTestConnection: (provider: CarrierProvider) => void | Promise<unknown>;
  onRegisterWebhook: (provider: CarrierProvider) => void | Promise<unknown>;
  onDisconnect: (provider: CarrierProvider) => void | Promise<unknown>;
  onLoadPickupLocations: () => Promise<string[]>;
}) {
  const { settings, tSafe, updateField } = props;
  const shipping = settings.shipping;
  const carriers = shipping.carriers;
  const shippo = carriers?.shippo;
  const shiprocket = carriers?.shiprocket;

  const cred = useCredentialMeta(settings);
  const env = settings._meta?.envSources?.shipping;

  const [pickupLocations, setPickupLocations] = useState<string[]>([]);
  const webhookOrigin = useClientValue(() => window.location.origin, "");

  // The public origin is only knowable in the browser; rendering it on the
  // server would bake a build-time host into a value operators copy-paste.
  const shippoMode = shippo?.mode === "live" ? "live" : "test";
  const shippoTokenPath =
    shippoMode === "live"
      ? "shipping.carriers.shippo.liveToken"
      : "shipping.carriers.shippo.testToken";
  const shippoTokenFromEnv =
    shippoMode === "live" ? env?.shippo?.liveToken : env?.shippo?.testToken;
  const shippoConfigured = Boolean(
    cred(shippoTokenPath).set || shippoTokenFromEnv,
  );

  const shiprocketConfigured = Boolean(
    (cred("shipping.carriers.shiprocket.email").set || env?.shiprocket?.email) &&
      (cred("shipping.carriers.shiprocket.password").set ||
        env?.shiprocket?.password) &&
      (shiprocket?.pickupLocationName ||
        env?.shiprocket?.pickupLocationName),
  );

  // Shiprocket's whole API assumes an Indian pickup postcode, so a store
  // shipping from anywhere else is told why rather than left to discover it
  // through an opaque 422 at label time.
  const originCountry = shipping.origin?.country;
  const shiprocketOriginOk = carrierSupportsOrigin("shiprocket", originCountry);

  // Shippo's own carrier accounts collect from eight countries; a store outside
  // them has to connect a carrier of its own before anything will quote. Worth
  // saying here rather than at the moment a merchant is trying to hand a parcel
  // to a courier.
  //
  // A caution, never a disabled toggle: a store here may already have connected
  // its own DHL Express or FedEx account, which originate worldwide, and this
  // screen cannot tell. Gating the toggle would switch Shippo off for a store
  // whose shipping works.
  const shippoOriginNote = originCountry
    ? shippoOriginHint(originCountry)
    : undefined;

  const actionButton = (
    provider: CarrierProvider,
    icon: React.ReactNode,
    label: string,
    onClick: () => void | Promise<unknown>,
    variant: "outline" | "ghost" = "outline",
  ) => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={props.isBusy}
      onClick={() => void onClick()}
      key={`${provider}-${label}`}
    >
      {props.isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {tSafe("admin.settings.shipping.carriers.title", "Shipping carriers")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tSafe(
              "admin.settings.shipping.carriers.description",
              "Connect a carrier account to buy real labels and track parcels automatically. Checkout keeps using your own shipping rates.",
            )}
          </p>
        </div>
        <Switch
          checked={carriers?.enabled ?? false}
          onCheckedChange={(checked) =>
            updateField("shipping.carriers.enabled", checked)
          }
          aria-label={tSafe(
            "admin.settings.shipping.carriers.enable",
            "Enable carriers",
          )}
        />
      </div>

      {carriers?.enabled ? (
        <div className="space-y-4">
          <ProviderCard
            logo={<ShippoLogo />}
            title={CARRIER_PROVIDER_LABELS.shippo}
            description={tSafe(
              "admin.settings.shipping.carriers.shippo.description",
              "USPS, UPS, FedEx, DHL and 40+ carriers worldwide.",
            )}
            enabled={shippo?.enabled ?? false}
            note={shippoOriginNote}
            onToggle={(checked) =>
              updateField("shipping.carriers.shippo.enabled", checked)
            }
            badges={
              <>
                <StatusBadge configured={shippoConfigured} />
                <ModeBadge mode={shippoMode} />
              </>
            }
            testButton={
              <div className="flex flex-wrap gap-2">
                {actionButton(
                  "shippo",
                  <Unplug className="h-4 w-4" />,
                  tSafe("admin.settings.shipping.carriers.disconnect", "Disconnect"),
                  () => props.onDisconnect("shippo"),
                  "ghost",
                )}
                {actionButton(
                  "shippo",
                  <Webhook className="h-4 w-4" />,
                  tSafe(
                    "admin.settings.shipping.carriers.registerWebhook",
                    "Generate webhook URL",
                  ),
                  () => props.onRegisterWebhook("shippo"),
                )}
                {actionButton(
                  "shippo",
                  <TestTube className="h-4 w-4" />,
                  tSafe(
                    "admin.settings.shipping.carriers.testConnection",
                    "Test connection",
                  ),
                  () => props.onTestConnection("shippo"),
                )}
              </div>
            }
          >
            {shippo?.authFailure ? (
              <AuthFailureNotice failure={shippo.authFailure} tSafe={tSafe} />
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="shippo-mode">
                {tSafe("admin.settings.shipping.carriers.mode", "Environment")}
              </Label>
              <Select
                value={shippoMode}
                onValueChange={(value) =>
                  updateField("shipping.carriers.shippo.mode", value)
                }
              >
                <SelectTrigger id="shippo-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">
                    {tSafe("admin.settings.shipping.carriers.modeTest", "Test")}
                  </SelectItem>
                  <SelectItem value="live">
                    {tSafe("admin.settings.shipping.carriers.modeLive", "Live")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.carriers.shippo.modeHint",
                  "Shippo has no separate sandbox — the token you use decides whether a label is real. Store both and switch here.",
                )}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SecretInput
                  id="shippo-test-token"
                  label={tSafe(
                    "admin.settings.shipping.carriers.shippo.testToken",
                    "Test API token",
                  )}
                  value={shippo?.testToken || ""}
                  onChange={(value) =>
                    updateField("shipping.carriers.shippo.testToken", value)
                  }
                  secretSet={cred("shipping.carriers.shippo.testToken").set}
                  maskedHint={cred("shipping.carriers.shippo.testToken").hint}
                  placeholderWhenUnset="shippo_test_..."
                />
                <EnvSourceHint show={env?.shippo?.testToken} />
              </div>
              <div>
                <SecretInput
                  id="shippo-live-token"
                  label={tSafe(
                    "admin.settings.shipping.carriers.shippo.liveToken",
                    "Live API token",
                  )}
                  value={shippo?.liveToken || ""}
                  onChange={(value) =>
                    updateField("shipping.carriers.shippo.liveToken", value)
                  }
                  secretSet={cred("shipping.carriers.shippo.liveToken").set}
                  maskedHint={cred("shipping.carriers.shippo.liveToken").hint}
                  placeholderWhenUnset="shippo_live_..."
                />
                <EnvSourceHint show={env?.shippo?.liveToken} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shippo-label-format">
                {tSafe(
                  "admin.settings.shipping.carriers.shippo.labelFormat",
                  "Label format",
                )}
              </Label>
              <Select
                value={shippo?.labelFileType || "PDF_4x6"}
                onValueChange={(value) =>
                  updateField("shipping.carriers.shippo.labelFileType", value)
                }
              >
                <SelectTrigger id="shippo-label-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PDF_4x6">PDF 4×6 (thermal)</SelectItem>
                  <SelectItem value="PDF">PDF (A4 / Letter)</SelectItem>
                  <SelectItem value="PNG">PNG</SelectItem>
                  <SelectItem value="ZPLII">ZPL II</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {shippo?.webhookRegisteredAt && webhookOrigin ? (
              <WebhookUrlRow
                label={tSafe(
                  "admin.settings.shipping.carriers.webhookUrl",
                  "Webhook URL — paste this into the carrier dashboard",
                )}
                url={`${webhookOrigin}/api/webhooks/carriers/shippo/${
                  shippo.webhookSecret || "<generated-secret>"
                }`}
              />
            ) : null}
          </ProviderCard>

          <ProviderCard
            logo={<ShiprocketLogo />}
            title={CARRIER_PROVIDER_LABELS.shiprocket}
            description={tSafe(
              "admin.settings.shipping.carriers.shiprocket.description",
              "Indian courier aggregator — Delhivery, Bluedart, Ekart and more.",
            )}
            enabled={shiprocket?.enabled ?? false}
            disabled={!shiprocketOriginOk}
            disabledNote={tSafe(
              "admin.settings.shipping.carriers.originNotSupported",
              "Shiprocket only dispatches from India. Set your shipping origin country to India to enable it.",
            )}
            onToggle={(checked) =>
              updateField("shipping.carriers.shiprocket.enabled", checked)
            }
            badges={<StatusBadge configured={shiprocketConfigured} />}
            testButton={
              <div className="flex flex-wrap gap-2">
                {actionButton(
                  "shiprocket",
                  <Unplug className="h-4 w-4" />,
                  tSafe("admin.settings.shipping.carriers.disconnect", "Disconnect"),
                  () => props.onDisconnect("shiprocket"),
                  "ghost",
                )}
                {actionButton(
                  "shiprocket",
                  <TestTube className="h-4 w-4" />,
                  tSafe(
                    "admin.settings.shipping.carriers.testConnection",
                    "Test connection",
                  ),
                  () => props.onTestConnection("shiprocket"),
                )}
              </div>
            }
          >
            {shiprocket?.authFailure ? (
              <AuthFailureNotice
                failure={shiprocket.authFailure}
                tSafe={tSafe}
              />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SecretInput
                  id="shiprocket-email"
                  label={tSafe(
                    "admin.settings.shipping.carriers.shiprocket.email",
                    "API user email",
                  )}
                  value={shiprocket?.email || ""}
                  onChange={(value) =>
                    updateField("shipping.carriers.shiprocket.email", value)
                  }
                  secretSet={cred("shipping.carriers.shiprocket.email").set}
                  maskedHint={cred("shipping.carriers.shiprocket.email").hint}
                  placeholderWhenUnset="api-user@example.com"
                  revealTyped
                />
                <EnvSourceHint show={env?.shiprocket?.email} />
              </div>
              <div>
                <SecretInput
                  id="shiprocket-password"
                  label={tSafe(
                    "admin.settings.shipping.carriers.shiprocket.password",
                    "API user password",
                  )}
                  value={shiprocket?.password || ""}
                  onChange={(value) =>
                    updateField("shipping.carriers.shiprocket.password", value)
                  }
                  secretSet={cred("shipping.carriers.shiprocket.password").set}
                  maskedHint={cred("shipping.carriers.shiprocket.password").hint}
                />
                <EnvSourceHint show={env?.shiprocket?.password} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shiprocket-pickup">
                {tSafe(
                  "admin.settings.shipping.carriers.pickupLocation",
                  "Pickup location",
                )}
              </Label>
              <div className="flex gap-2">
                {pickupLocations.length > 0 ? (
                  <Select
                    value={shiprocket?.pickupLocationName || ""}
                    onValueChange={(value) =>
                      updateField(
                        "shipping.carriers.shiprocket.pickupLocationName",
                        value,
                      )
                    }
                  >
                    <SelectTrigger id="shiprocket-pickup" className="flex-1">
                      <SelectValue placeholder="Select a pickup location" />
                    </SelectTrigger>
                    <SelectContent>
                      {pickupLocations.map((location) => (
                        <SelectItem key={location} value={location}>
                          {location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="shiprocket-pickup"
                    className="flex-1"
                    value={shiprocket?.pickupLocationName || ""}
                    onChange={(e) =>
                      updateField(
                        "shipping.carriers.shiprocket.pickupLocationName",
                        e.target.value,
                      )
                    }
                    placeholder="Primary"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={props.isBusy}
                  aria-label={tSafe(
                    "admin.settings.shipping.carriers.refreshPickupLocations",
                    "Refresh pickup locations",
                  )}
                  onClick={() => {
                    void props.onLoadPickupLocations().then(setPickupLocations);
                  }}
                >
                  {props.isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.carriers.shiprocket.pickupHint",
                  "Shiprocket ships from a nickname you register in their dashboard, not from a free-form address. Nothing can be dispatched until one is selected.",
                )}
              </p>
              <EnvSourceHint show={env?.shiprocket?.pickupLocationName} />
            </div>

            <Separator />

            <div>
              <SecretInput
                id="shiprocket-webhook-token"
                label={tSafe(
                  "admin.settings.shipping.carriers.shiprocket.webhookToken",
                  "Webhook token (x-api-key)",
                )}
                value={shiprocket?.webhookToken || ""}
                onChange={(value) =>
                  updateField("shipping.carriers.shiprocket.webhookToken", value)
                }
                secretSet={cred("shipping.carriers.shiprocket.webhookToken").set}
                maskedHint={cred("shipping.carriers.shiprocket.webhookToken").hint}
                helperText={tSafe(
                  "admin.settings.shipping.carriers.shiprocket.webhookHint",
                  "Set the same value in Shiprocket's webhook settings; tracking updates that do not carry it are rejected.",
                )}
              />
              <EnvSourceHint show={env?.shiprocket?.webhookToken} />
            </div>

            {webhookOrigin ? (
              <WebhookUrlRow
                label={tSafe(
                  "admin.settings.shipping.carriers.webhookUrl",
                  "Webhook URL — paste this into the carrier dashboard",
                )}
                url={`${webhookOrigin}/api/webhooks/carriers/shiprocket`}
              />
            ) : null}
          </ProviderCard>
        </div>
      ) : null}
    </div>
  );
}
