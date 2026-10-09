"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  RefreshCw,
  ShieldAlert,
  TestTube,
  Unplug,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { WebhookUrlRow } from "@/components/admin/settings/fields/webhook-url-row";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { FeatureGroup } from "@/components/admin/settings/fields/feature-row";
import {
  ModeBadge,
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
import { EditDialogHeader, Segmented } from "./dialog-fields";
import { ItemRow } from "./item-row";
import { useClientValue } from "@/hooks/use-client-value";

export type CarrierActions = {
  isBusy: boolean;
  /** The shipping section has unsaved changes; the carrier actions work on what is saved. */
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void | Promise<unknown>;
  onTestConnection: (provider: CarrierProvider) => void | Promise<unknown>;
  onRegisterWebhook: (provider: CarrierProvider) => void | Promise<unknown>;
  onDisconnect: (provider: CarrierProvider) => void | Promise<unknown>;
  onLoadPickupLocations: () => Promise<string[]>;
};

/**
 * The carrier is refusing our credentials.
 *
 * Loud on purpose, and above the fields rather than beside a badge: while this
 * is showing, every parcel queued for this carrier dead-letters on its first
 * attempt. Nothing else on the screen would say so — the carrier still reads as
 * connected, because a stored token looks identical whether or not it still
 * works.
 */
function AuthFailureNotice(props: { failure: CarrierAuthFailure }) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const when = new Date(props.failure.at);
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="space-y-1 text-xs">
        <p className="font-medium text-destructive">{t("authFailed")}</p>
        {props.failure.message ? (
          <p className="text-muted-foreground">{props.failure.message}</p>
        ) : null}
        <p className="text-muted-foreground">
          {t("authFailedHint")}
          {Number.isFinite(when.getTime())
            ? ` (${when.toLocaleString()})`
            : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Settings → Shipping & Delivery → Carriers & labels → Carrier accounts: one
 * row per carrier, saying whether it is on, has its credentials and is being
 * refused, with the credentials themselves behind Manage. They used to sit
 * open on the page, two tall forms of tokens and webhook URLs between the
 * rates and the packages.
 */
export function CarrierAccounts(
  props: CarrierActions & {
    settings: Settings;
    updateField: (path: string, value: unknown) => void;
  },
) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const { settings } = props;
  const shipping = settings.shipping;
  const shippo = shipping.carriers?.shippo;
  const shiprocket = shipping.carriers?.shiprocket;
  const cred = useCredentialMeta(settings);
  const env = settings._meta?.envSources?.shipping;
  const [open, setOpen] = useState<CarrierProvider | null>(null);

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
      (shiprocket?.pickupLocationName || env?.shiprocket?.pickupLocationName),
  );

  // Shiprocket's whole API assumes an Indian pickup postcode, so a store
  // shipping from anywhere else is told why rather than left to discover it
  // through an opaque 422 at label time.
  const originCountry = shipping.origin?.country;
  const shiprocketOriginOk = carrierSupportsOrigin("shiprocket", originCountry);

  // Shippo's own carrier accounts collect from eight countries; a store outside
  // them has to connect a carrier of its own before anything will quote. A
  // caution, never a disabled button: a store here may already have connected
  // its own DHL Express or FedEx account, which originate worldwide, and this
  // screen cannot tell.
  const shippoOriginNote = originCountry
    ? shippoOriginHint(originCountry)
    : undefined;

  const status = (
    enabled: boolean,
    configured: boolean,
    failure: CarrierAuthFailure | undefined,
    mode?: "test" | "live",
  ) => {
    if (!enabled) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {t("off")}
        </Badge>
      );
    }
    if (failure) {
      return (
        <Badge
          variant="secondary"
          className="bg-destructive/10 text-destructive hover:bg-destructive/15"
        >
          {t("rejected")}
        </Badge>
      );
    }
    return (
      <>
        <StatusBadge configured={configured} />
        {mode ? <ModeBadge mode={mode} /> : null}
      </>
    );
  };

  const shippoOn = shippo?.enabled ?? false;
  const shiprocketOn = (shiprocket?.enabled ?? false) && shiprocketOriginOk;
  // Disconnect clears what is stored here, whichever mode is in use; a
  // credential that comes from the environment is not this screen's to clear.
  const shippoStored =
    cred("shipping.carriers.shippo.testToken").set ||
    cred("shipping.carriers.shippo.liveToken").set;
  const shiprocketStored =
    cred("shipping.carriers.shiprocket.email").set ||
    cred("shipping.carriers.shiprocket.password").set;

  return (
    <FeatureGroup title={t("accountsHeading")}>
      <ItemRow
        icon={<ShippoLogo className="h-9 w-9" />}
        title={CARRIER_PROVIDER_LABELS.shippo}
        badges={status(shippoOn, shippoConfigured, shippo?.authFailure, shippoMode)}
        description={t("shippo.description")}
        note={shippoOriginNote}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen("shippo")}
          >
            {shippoOn ? t("manage") : t("connect")}
          </Button>
        }
      />
      <ItemRow
        icon={<ShiprocketLogo className="h-9 w-9" />}
        title={CARRIER_PROVIDER_LABELS.shiprocket}
        badges={status(
          shiprocketOn,
          shiprocketConfigured,
          shiprocket?.authFailure,
        )}
        description={t("shiprocket.description")}
        note={shiprocketOriginOk ? undefined : t("originNotSupported")}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!shiprocketOriginOk}
            onClick={() => setOpen("shiprocket")}
          >
            {shiprocketOn ? t("manage") : t("connect")}
          </Button>
        }
      />

      {open === "shippo" ? (
        <CarrierDialog
          {...props}
          provider="shippo"
          logo={<ShippoLogo />}
          enabled={shippoOn}
          canDisconnect={shippoStored}
          badges={status(shippoOn, shippoConfigured, shippo?.authFailure, shippoMode)}
          onClose={() => setOpen(null)}
        >
          <ShippoFields {...props} />
        </CarrierDialog>
      ) : null}

      {open === "shiprocket" ? (
        <CarrierDialog
          {...props}
          provider="shiprocket"
          logo={<ShiprocketLogo />}
          enabled={shiprocketOn}
          canDisconnect={shiprocketStored}
          badges={status(
            shiprocketOn,
            shiprocketConfigured,
            shiprocket?.authFailure,
          )}
          onClose={() => setOpen(null)}
        >
          <ShiprocketFields {...props} />
        </CarrierDialog>
      ) : null}
    </FeatureGroup>
  );
}

/**
 * One carrier's switch, credentials and actions.
 *
 * It edits the page's settings directly rather than a copy: Test connection,
 * the webhook and Disconnect act on what is saved, so a token typed here has
 * to show up as an unsaved change — and the dialog offers Save itself, since
 * the page's save bar sits behind it.
 */
function CarrierDialog(
  props: CarrierActions & {
    provider: CarrierProvider;
    logo: ReactNode;
    enabled: boolean;
    canDisconnect: boolean;
    badges: ReactNode;
    updateField: (path: string, value: unknown) => void;
    onClose: () => void;
    children: ReactNode;
  },
) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const tFields = useTranslations("admin.settings.fields");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const name = CARRIER_PROVIDER_LABELS[props.provider];
  const busy = props.isBusy || props.isSaving;
  const spinner = <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onClose())}>
      <DialogContent className="grid-cols-1 gap-0 p-0 sm:max-w-2xl">
        <EditDialogHeader>
          <div className="flex items-center gap-3">
            {props.logo}
            <div className="min-w-0 space-y-1">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {name}
                {props.badges}
              </DialogTitle>
              <DialogDescription>
                {props.provider === "shippo"
                  ? t("shippo.description")
                  : t("shiprocket.description")}
              </DialogDescription>
            </div>
          </div>
        </EditDialogHeader>

        <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto px-6 py-5">
          <label className="flex cursor-pointer items-center gap-4 rounded-xl border p-3.5">
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block text-sm font-medium">
                {tFields("enableProvider", { name })}
              </span>
              <span className="text-muted-foreground block text-xs">{t("enableHint")}</span>
            </span>
            <Switch
              checked={props.enabled}
              aria-label={tFields("enableProvider", { name })}
              onCheckedChange={(checked) =>
                props.updateField(`shipping.carriers.${props.provider}.enabled`, checked)
              }
            />
          </label>
          {props.children}
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 border-t px-6 py-4 sm:justify-between">
          {props.canDisconnect ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive px-2"
              disabled={busy}
              onClick={() => void props.onDisconnect(props.provider)}
            >
              {props.isBusy ? spinner : <Unplug className="h-4 w-4" />}
              {t("disconnect")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void props.onTestConnection(props.provider)}
            >
              {props.isBusy ? spinner : <TestTube className="h-4 w-4" />}
              {t("testConnection")}
            </Button>
            {props.isDirty ? (
              <Button type="button" disabled={busy} onClick={() => void props.onSave()}>
                {props.isSaving ? spinner : null}
                {tSettings("general.save")}
              </Button>
            ) : (
              <Button type="button" onClick={props.onClose}>
                {tCommon("done")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Test or real labels, as two buttons: which token is in use is the whole question. */
function ModeToggle(props: {
  value: "test" | "live";
  onChange: (mode: "test" | "live") => void;
}) {
  const t = useTranslations("admin.settings.shipping.carriers");
  return (
    <div className="space-y-1.5">
      <p id="shippo-mode-label" className="text-sm font-medium">
        {t("mode")}
      </p>
      <Segmented
        labelledBy="shippo-mode-label"
        className="inline-grid grid-cols-2"
        value={props.value}
        options={[
          { id: "test", label: t("modeTest") },
          { id: "live", label: t("modeLive") },
        ]}
        onChange={props.onChange}
      />
      <p className="text-muted-foreground text-xs">{t("shippo.modeHint")}</p>
    </div>
  );
}

function ShippoFields(
  props: CarrierActions & {
    settings: Settings;
    updateField: (path: string, value: unknown) => void;
  },
) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const { settings, updateField } = props;
  const shippo = settings.shipping.carriers?.shippo;
  const cred = useCredentialMeta(settings);
  const env = settings._meta?.envSources?.shipping;
  // The public origin is only knowable in the browser; rendering it on the
  // server would bake a build-time host into a value operators copy-paste.
  const webhookOrigin = useClientValue(() => window.location.origin, "");

  return (
    <>
      {shippo?.authFailure ? <AuthFailureNotice failure={shippo.authFailure} /> : null}

      <ModeToggle
        value={shippo?.mode === "live" ? "live" : "test"}
        onChange={(mode) => updateField("shipping.carriers.shippo.mode", mode)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <SecretInput
            id="shippo-test-token"
            label={t("shippo.testToken")}
            value={shippo?.testToken || ""}
            onChange={(value) => updateField("shipping.carriers.shippo.testToken", value)}
            secretSet={cred("shipping.carriers.shippo.testToken").set}
            maskedHint={cred("shipping.carriers.shippo.testToken").hint}
            placeholderWhenUnset="shippo_test_..."
          />
          <EnvSourceHint show={env?.shippo?.testToken} />
        </div>
        <div className="min-w-0">
          <SecretInput
            id="shippo-live-token"
            label={t("shippo.liveToken")}
            value={shippo?.liveToken || ""}
            onChange={(value) => updateField("shipping.carriers.shippo.liveToken", value)}
            secretSet={cred("shipping.carriers.shippo.liveToken").set}
            maskedHint={cred("shipping.carriers.shippo.liveToken").hint}
            placeholderWhenUnset="shippo_live_..."
          />
          <EnvSourceHint show={env?.shippo?.liveToken} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="shippo-label-format">{t("shippo.labelFormat")}</Label>
        <Select
          value={shippo?.labelFileType || "PDF_4x6"}
          onValueChange={(value) => updateField("shipping.carriers.shippo.labelFileType", value)}
        >
          <SelectTrigger id="shippo-label-format" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PDF_4x6">{t("shippo.labelFormats.pdf4x6")}</SelectItem>
            <SelectItem value="PDF">{t("shippo.labelFormats.pdf")}</SelectItem>
            <SelectItem value="PNG">PNG</SelectItem>
            <SelectItem value="ZPLII">ZPL II</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 rounded-xl border p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-56 space-y-0.5">
            <p className="text-sm font-medium">{t("trackingUpdates")}</p>
            <p className="text-muted-foreground text-xs">{t("shippo.webhookHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.isBusy || props.isSaving}
            onClick={() => void props.onRegisterWebhook("shippo")}
          >
            {props.isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Webhook className="h-4 w-4" />
            )}
            {t("registerWebhook")}
          </Button>
        </div>
        {shippo?.webhookRegisteredAt && webhookOrigin ? (
          <WebhookUrlRow
            label={t("webhookUrl")}
            url={`${webhookOrigin}/api/webhooks/carriers/shippo/${
              shippo.webhookSecret || "<generated-secret>"
            }`}
          />
        ) : null}
      </div>
    </>
  );
}

function ShiprocketFields(
  props: CarrierActions & {
    settings: Settings;
    updateField: (path: string, value: unknown) => void;
  },
) {
  const t = useTranslations("admin.settings.shipping.carriers");
  const { settings, updateField } = props;
  const shiprocket = settings.shipping.carriers?.shiprocket;
  const cred = useCredentialMeta(settings);
  const env = settings._meta?.envSources?.shipping;
  const webhookOrigin = useClientValue(() => window.location.origin, "");
  const [pickupLocations, setPickupLocations] = useState<string[]>([]);

  return (
    <>
      {shiprocket?.authFailure ? (
        <AuthFailureNotice failure={shiprocket.authFailure} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <SecretInput
            id="shiprocket-email"
            label={t("shiprocket.email")}
            value={shiprocket?.email || ""}
            onChange={(value) => updateField("shipping.carriers.shiprocket.email", value)}
            secretSet={cred("shipping.carriers.shiprocket.email").set}
            maskedHint={cred("shipping.carriers.shiprocket.email").hint}
            placeholderWhenUnset="api-user@example.com"
            revealTyped
          />
          <EnvSourceHint show={env?.shiprocket?.email} />
        </div>
        <div className="min-w-0">
          <SecretInput
            id="shiprocket-password"
            label={t("shiprocket.password")}
            value={shiprocket?.password || ""}
            onChange={(value) => updateField("shipping.carriers.shiprocket.password", value)}
            secretSet={cred("shipping.carriers.shiprocket.password").set}
            maskedHint={cred("shipping.carriers.shiprocket.password").hint}
          />
          <EnvSourceHint show={env?.shiprocket?.password} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="shiprocket-pickup">{t("pickupLocation")}</Label>
        <div className="flex gap-2">
          {pickupLocations.length > 0 ? (
            <Select
              value={shiprocket?.pickupLocationName || ""}
              onValueChange={(value) =>
                updateField("shipping.carriers.shiprocket.pickupLocationName", value)
              }
            >
              <SelectTrigger id="shiprocket-pickup" className="min-w-0 flex-1">
                <SelectValue placeholder={t("shiprocket.pickupPlaceholder")} />
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
              className="min-w-0 flex-1"
              value={shiprocket?.pickupLocationName || ""}
              onChange={(event) =>
                updateField(
                  "shipping.carriers.shiprocket.pickupLocationName",
                  event.target.value,
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
            aria-label={t("refreshPickupLocations")}
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
        <p className="text-muted-foreground text-xs">{t("shiprocket.pickupHint")}</p>
        <EnvSourceHint show={env?.shiprocket?.pickupLocationName} />
      </div>

      <div className="space-y-3 rounded-xl border p-3.5">
        <p className="text-sm font-medium">{t("trackingUpdates")}</p>
        <div>
          <SecretInput
            id="shiprocket-webhook-token"
            label={t("shiprocket.webhookToken")}
            value={shiprocket?.webhookToken || ""}
            onChange={(value) => updateField("shipping.carriers.shiprocket.webhookToken", value)}
            secretSet={cred("shipping.carriers.shiprocket.webhookToken").set}
            maskedHint={cred("shipping.carriers.shiprocket.webhookToken").hint}
            helperText={t("shiprocket.webhookHint")}
          />
          <EnvSourceHint show={env?.shiprocket?.webhookToken} />
        </div>
        {webhookOrigin ? (
          <WebhookUrlRow
            label={t("webhookUrl")}
            url={`${webhookOrigin}/api/webhooks/carriers/shiprocket`}
          />
        ) : null}
      </div>
    </>
  );
}
