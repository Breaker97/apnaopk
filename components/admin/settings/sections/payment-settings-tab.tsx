"use client";

import { useTranslations } from "next-intl";
import { Loader2, TestTube, Banknote, Webhook } from "lucide-react";
import {
  StripeLogo,
  PayPalLogo,
  RazorpayLogo,
  PaystackLogo,
  PesapalLogo,
  IotecLogo,
  OrangeMoneyLogo,
  MtnMomoLogo,
  CashOnDeliveryLogo,
  TurnstileLogo,
} from "./payment-brand-logos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import { WebhookUrlRow } from "@/components/admin/settings/fields/webhook-url-row";
import {
  ModeBadge,
  ProviderCard,
  StatusBadge,
} from "@/components/admin/settings/fields/provider-card";
import type { Settings } from "@/components/admin/settings/types";
import { useClientValue } from "@/hooks/use-client-value";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { StickySaveFooter } from "./sticky-save-footer";
import { SettingsTabHeader } from "./settings-tab-header";

type ProviderId =
  | "stripe"
  | "paypal"
  | "razorpay"
  | "paystack"
  | "pesapal"
  | "iotec"
  | "orange_money"
  | "mtn_momo";

export function PaymentSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isTestingPayment: boolean;
  isRegisteringPesapalIpn: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onTestConnection: (provider: ProviderId) => void | Promise<unknown>;
  onRegisterPesapalIpn: () => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const {
    settings,
    isSaving,
    isDirty,
    isTestingPayment,
    isRegisteringPesapalIpn,
    updateNestedField,
    onSave,
    onTestConnection,
    onRegisterPesapalIpn,
  } = props;

  const stripe = settings.payment?.stripe;
  const razorpay = settings.payment?.razorpay;
  // The public origin is only knowable in the browser; rendering it on the
  // server would bake a build-time host into a URL operators copy-paste.
  const webhookOrigin = useClientValue(() => window.location.origin, "");
  const paystack = settings.payment?.paystack;
  const pesapal = settings.payment?.pesapal;
  const iotec = settings.payment?.iotec;
  const orangeMoney = settings.payment?.orange_money;
  const mtnMomo = settings.payment?.mtn_momo;
  const paypal = settings.payment?.paypal;
  const cod = settings.payment?.cod;
  const turnstile = settings.payment?.turnstile;

  // Credential values are stripped server-side; presence + masked previews and
  // the test/live key mode arrive via _meta instead.
  const cred = useCredentialMeta(settings);
  const keyModes = settings._meta?.keyModes;
  const stripeMode = keyModes?.stripe ?? null;
  const razorpayMode = keyModes?.razorpay ?? null;
  const paystackMode = keyModes?.paystack ?? null;
  const paypalMode = paypal?.mode === "live" ? "live" : "sandbox";
  const pesapalMode = pesapal?.mode === "live" ? "live" : "sandbox";
  const iotecMode = iotec?.mode === "live" ? "live" : "sandbox";
  const orangeMoneyMode = orangeMoney?.mode === "live" ? "live" : "sandbox";
  const mtnMomoMode = mtnMomo?.mode === "live" ? "live" : "sandbox";

  // Per-field .env fallback presence (DB still wins when a value is saved).
  const env = settings._meta?.envSources?.payment;

  const stripeConfigured = Boolean(
    (cred("payment.stripe.publishableKey").set || env?.stripe.publishableKey) &&
      (cred("payment.stripe.secretKey").set || env?.stripe.secretKey),
  );
  const razorpayConfigured = Boolean(
    (cred("payment.razorpay.keyId").set || env?.razorpay.keyId) &&
      (cred("payment.razorpay.keySecret").set || env?.razorpay.keySecret),
  );
  const paystackConfigured = Boolean(
    (cred("payment.paystack.publicKey").set || env?.paystack.publicKey) &&
      (cred("payment.paystack.secretKey").set || env?.paystack.secretKey),
  );
  const paypalConfigured = Boolean(
    (cred("payment.paypal.clientId").set || env?.paypal.clientId) &&
      (cred("payment.paypal.clientSecret").set || env?.paypal.clientSecret),
  );
  const pesapalConfigured = Boolean(
    (cred("payment.pesapal.consumerKey").set || env?.pesapal.consumerKey) &&
      (cred("payment.pesapal.consumerSecret").set ||
        env?.pesapal.consumerSecret) &&
      (cred("payment.pesapal.ipnId").set || env?.pesapal.ipnId),
  );
  const iotecConfigured = Boolean(
    (cred("payment.iotec.clientId").set || env?.iotec.clientId) &&
      (cred("payment.iotec.clientSecret").set || env?.iotec.clientSecret) &&
      (cred("payment.iotec.walletId").set || env?.iotec.walletId),
  );
  const orangeMoneyConfigured = Boolean(
    (cred("payment.orange_money.clientId").set ||
      env?.orange_money.clientId) &&
      (cred("payment.orange_money.clientSecret").set ||
        env?.orange_money.clientSecret) &&
      (cred("payment.orange_money.merchantKey").set ||
        env?.orange_money.merchantKey),
  );
  const mtnMomoConfigured = Boolean(
    (cred("payment.mtn_momo.subscriptionKey").set ||
      env?.mtn_momo.subscriptionKey) &&
      (cred("payment.mtn_momo.apiUser").set || env?.mtn_momo.apiUser) &&
      (cred("payment.mtn_momo.apiKey").set || env?.mtn_momo.apiKey),
  );

  const renderTestButton = (provider: ProviderId, enabled: boolean) => {
    if (!enabled) return null;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onTestConnection(provider)}
        disabled={isSaving || isTestingPayment}
      >
        {isTestingPayment ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <TestTube className="h-4 w-4 mr-2" />
        )}
        {t("admin.settings.payment.testConnection")}
      </Button>
    );
  };

  // A switch alone does not put a gateway on the checkout: it also needs its
  // keys and a store currency it settles. The server applies that rule for the
  // storefront and reports it here from the saved settings, so a switched-on
  // gateway that checkout will not offer says why instead of silently going
  // missing.
  const checkoutGateways = settings._meta?.checkoutGateways;
  const checkoutNote = (provider: ProviderId, enabled: boolean | undefined) => {
    const readiness = checkoutGateways?.[provider];
    if (!enabled || !readiness || readiness.ready) return undefined;
    if (readiness.missing === "currency") {
      // A wallet's short list is worth reading; PayPal's two dozen codes or
      // Stripe's hundred-odd are not, and the store's own is what matters.
      return readiness.currencies.length <= 12
        ? t("admin.settings.payment.checkout.currencyListed", {
            currency: readiness.currency,
            currencies: readiness.currencies.join(", "),
          })
        : t("admin.settings.payment.checkout.currency", {
            currency: readiness.currency,
          });
    }
    return t("admin.settings.payment.checkout.keys");
  };

  // Razorpay takes its home currencies (rupees, and ringgit through Curlec) on
  // every account, and anything else only once the merchant has activated
  // International Payments — which nothing on this screen can see, so it is
  // said rather than checked.
  const storeCurrency = String(
    settings.general?.defaultCurrency || DEFAULT_CURRENCY,
  ).toUpperCase();
  const razorpayNote =
    checkoutNote("razorpay", razorpay?.enabled) ??
    (razorpay?.enabled && storeCurrency !== "INR" && storeCurrency !== "MYR"
      ? t("admin.settings.payment.razorpay.internationalNote", {
          currency: storeCurrency,
        })
      : undefined);

  const gatewaySwitches: Record<ProviderId, boolean | undefined> = {
    stripe: stripe?.enabled,
    paypal: paypal?.enabled,
    razorpay: razorpay?.enabled,
    paystack: paystack?.enabled,
    pesapal: pesapal?.enabled,
    iotec: iotec?.enabled,
    orange_money: orangeMoney?.enabled,
    mtn_momo: mtnMomo?.enabled,
  };
  // Counted the way checkout counts. Every switch used to count, so a store
  // read "8 active" while checkout offered cash on delivery alone.
  const activeCount =
    (Object.keys(gatewaySwitches) as ProviderId[]).filter(
      (provider) =>
        gatewaySwitches[provider] &&
        (checkoutGateways?.[provider]?.ready ?? true),
    ).length + (cod?.enabled ? 1 : 0);

  return (
    <div className="relative">
      <div className="space-y-6">
        <SettingsTabHeader
          title={t("admin.settings.payment.title")}
          description={t("admin.settings.payment.description")}
          meta={
            <Badge variant="secondary">
              {t("admin.settings.payment.activeCount", { count: activeCount })}
            </Badge>
          }
        />

        {/* Stripe */}
        <ProviderCard
          logo={<StripeLogo />}
          title={t("admin.settings.payment.stripe.title")}
          description={t("admin.settings.payment.stripe.description")}
          enabled={stripe?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.stripe.enabled", c)}
          note={checkoutNote("stripe", stripe?.enabled)}
          badges={
            <>
              <StatusBadge configured={stripeConfigured} />
              {stripeMode && <ModeBadge mode={stripeMode} />}
            </>
          }
          testButton={renderTestButton("stripe", stripe?.enabled ?? false)}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="stripePublishableKey"
                label={t("admin.settings.payment.stripePublishableKey")}
                value={stripe?.publishableKey || ""}
                onChange={(v) =>
                  updateNestedField("payment.stripe.publishableKey", v)
                }
                onClear={() => updateNestedField("payment.stripe.publishableKey", null)}
                secretSet={cred("payment.stripe.publishableKey").set}
                maskedHint={cred("payment.stripe.publishableKey").hint}
                placeholderWhenUnset="pk_live_… / pk_test_…"
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.stripe.publishableKey)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="stripeSecretKey"
                label={t("admin.settings.payment.stripe.secretKey")}
                value={stripe?.secretKey || ""}
                onChange={(v) => updateNestedField("payment.stripe.secretKey", v)}
                onClear={() => updateNestedField("payment.stripe.secretKey", null)}
                secretSet={cred("payment.stripe.secretKey").set}
                maskedHint={cred("payment.stripe.secretKey").hint}
                placeholderWhenUnset="sk_live_… / sk_test_…"
                helperText={t("admin.settings.fields.savedKeysHint")}
              />
              <EnvSourceHint show={Boolean(env?.stripe.secretKey)} />
            </div>
          </div>
          <SecretInput
            id="stripeWebhookSecret"
            label={t("admin.settings.payment.stripeWebhookSecret")}
            value={stripe?.webhookSecret || ""}
            onChange={(v) =>
              updateNestedField("payment.stripe.webhookSecret", v)
            }
            onClear={() => updateNestedField("payment.stripe.webhookSecret", null)}
            secretSet={cred("payment.stripe.webhookSecret").set}
            maskedHint={cred("payment.stripe.webhookSecret").hint}
            placeholderWhenUnset="whsec_..."
            helperText={t("admin.settings.payment.stripe.webhookSecretHint")}
          />
          <EnvSourceHint show={Boolean(env?.stripe.webhookSecret)} />
        </ProviderCard>

        {/* PayPal */}
        <ProviderCard
          logo={<PayPalLogo />}
          title={t("admin.settings.payment.paypal.title")}
          description={t("admin.settings.payment.paypal.description")}
          enabled={paypal?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.paypal.enabled", c)}
          note={checkoutNote("paypal", paypal?.enabled)}
          badges={
            <>
              <StatusBadge configured={paypalConfigured} />
              <ModeBadge mode={paypalMode} />
            </>
          }
          testButton={renderTestButton("paypal", paypal?.enabled ?? false)}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="paypalClientId"
                label={t("admin.settings.payment.paypalClientId")}
                value={paypal?.clientId || ""}
                onChange={(v) => updateNestedField("payment.paypal.clientId", v)}
                onClear={() => updateNestedField("payment.paypal.clientId", null)}
                secretSet={cred("payment.paypal.clientId").set}
                maskedHint={cred("payment.paypal.clientId").hint}
                placeholderWhenUnset={t("admin.settings.payment.paypal.clientIdPlaceholder")}
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.paypal.clientId)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="paypalClientSecret"
                label={t("admin.settings.payment.paypal.clientSecret")}
                value={paypal?.clientSecret || ""}
                onChange={(v) =>
                  updateNestedField("payment.paypal.clientSecret", v)
                }
                onClear={() => updateNestedField("payment.paypal.clientSecret", null)}
                secretSet={cred("payment.paypal.clientSecret").set}
                maskedHint={cred("payment.paypal.clientSecret").hint}
                helperText={t("admin.settings.fields.savedSecretsHint")}
              />
              <EnvSourceHint show={Boolean(env?.paypal.clientSecret)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paypalMode">
                {t("admin.settings.payment.paypalMode")}
              </Label>
              <Select
                value={paypal?.mode}
                onValueChange={(v) => updateNestedField("payment.paypal.mode", v)}
              >
                <SelectTrigger id="paypalMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    {t("admin.settings.payment.paypalSandbox")}
                  </SelectItem>
                  <SelectItem value="live">
                    {t("admin.settings.payment.paypalLive")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <SecretInput
                id="paypalWebhookId"
                label={t("admin.settings.payment.paypalWebhookId")}
                value={paypal?.webhookId || ""}
                onChange={(v) =>
                  updateNestedField("payment.paypal.webhookId", v)
                }
                onClear={() => updateNestedField("payment.paypal.webhookId", null)}
                secretSet={cred("payment.paypal.webhookId").set}
                maskedHint={cred("payment.paypal.webhookId").hint}
                placeholderWhenUnset={t("admin.settings.payment.paypal.webhookIdPlaceholder")}
                revealTyped
              />
            </div>
          </div>
        </ProviderCard>

        {/* Razorpay */}
        <ProviderCard
          logo={<RazorpayLogo />}
          title="Razorpay"
          description={t("admin.settings.payment.razorpay.description")}
          enabled={razorpay?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.razorpay.enabled", c)}
          note={razorpayNote}
          badges={
            <>
              <StatusBadge configured={razorpayConfigured} />
              {razorpayMode && <ModeBadge mode={razorpayMode} />}
            </>
          }
          testButton={renderTestButton(
            "razorpay",
            razorpay?.enabled ?? false,
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="razorpayKeyId"
                label={t("admin.settings.payment.fields.keyId")}
                value={razorpay?.keyId || ""}
                onChange={(v) => updateNestedField("payment.razorpay.keyId", v)}
                onClear={() => updateNestedField("payment.razorpay.keyId", null)}
                secretSet={cred("payment.razorpay.keyId").set}
                maskedHint={cred("payment.razorpay.keyId").hint}
                placeholderWhenUnset="rzp_test_… / rzp_live_…"
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.razorpay.keyId)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="razorpayKeySecret"
                label={t("admin.settings.payment.fields.keySecret")}
                value={razorpay?.keySecret || ""}
                onChange={(v) =>
                  updateNestedField("payment.razorpay.keySecret", v)
                }
                onClear={() => updateNestedField("payment.razorpay.keySecret", null)}
                secretSet={cred("payment.razorpay.keySecret").set}
                maskedHint={cred("payment.razorpay.keySecret").hint}
                placeholderWhenUnset={t("admin.settings.payment.razorpay.keySecretPlaceholder")}
                helperText={t("admin.settings.fields.savedKeysHint")}
              />
              <EnvSourceHint show={Boolean(env?.razorpay.keySecret)} />
            </div>
          </div>
          <SecretInput
            id="razorpayWebhookSecret"
            label={t("admin.settings.payment.fields.webhookSecret")}
            value={razorpay?.webhookSecret || ""}
            onChange={(v) =>
              updateNestedField("payment.razorpay.webhookSecret", v)
            }
            onClear={() => updateNestedField("payment.razorpay.webhookSecret", null)}
            secretSet={cred("payment.razorpay.webhookSecret").set}
            maskedHint={cred("payment.razorpay.webhookSecret").hint}
            placeholderWhenUnset={t("admin.settings.payment.razorpay.webhookSecretPlaceholder")}
            helperText={t("admin.settings.payment.razorpay.webhookSecretHint")}
          />
          <EnvSourceHint show={Boolean(env?.razorpay.webhookSecret)} />
          {webhookOrigin ? (
            <WebhookUrlRow
              label={t("admin.settings.payment.fields.webhookUrl")}
              url={`${webhookOrigin}/api/payments/razorpay/webhook`}
              helperText={t("admin.settings.payment.razorpay.webhookUrlHint")}
            />
          ) : null}
        </ProviderCard>

        {/* Paystack */}
        <ProviderCard
          logo={<PaystackLogo />}
          title="Paystack"
          description={t("admin.settings.payment.paystack.description")}
          enabled={paystack?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.paystack.enabled", c)}
          note={checkoutNote("paystack", paystack?.enabled)}
          badges={
            <>
              <StatusBadge configured={paystackConfigured} />
              {paystackMode && <ModeBadge mode={paystackMode} />}
            </>
          }
          testButton={renderTestButton(
            "paystack",
            paystack?.enabled ?? false,
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="paystackPublicKey"
                label={t("admin.settings.payment.fields.publicKey")}
                value={paystack?.publicKey || ""}
                onChange={(v) =>
                  updateNestedField("payment.paystack.publicKey", v)
                }
                onClear={() => updateNestedField("payment.paystack.publicKey", null)}
                secretSet={cred("payment.paystack.publicKey").set}
                maskedHint={cred("payment.paystack.publicKey").hint}
                placeholderWhenUnset="pk_test_… / pk_live_…"
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.paystack.publicKey)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="paystackSecretKey"
                label={t("admin.settings.payment.fields.secretKey")}
                value={paystack?.secretKey || ""}
                onChange={(v) =>
                  updateNestedField("payment.paystack.secretKey", v)
                }
                onClear={() => updateNestedField("payment.paystack.secretKey", null)}
                secretSet={cred("payment.paystack.secretKey").set}
                maskedHint={cred("payment.paystack.secretKey").hint}
                placeholderWhenUnset="sk_test_… / sk_live_…"
                helperText={t("admin.settings.fields.savedKeysHint")}
              />
              <EnvSourceHint show={Boolean(env?.paystack.secretKey)} />
            </div>
          </div>
        </ProviderCard>

        {/* Pesapal */}
        <ProviderCard
          logo={<PesapalLogo />}
          title="Pesapal"
          description={t("admin.settings.payment.pesapal.description")}
          enabled={pesapal?.enabled ?? false}
          onToggle={(checked) =>
            updateNestedField("payment.pesapal.enabled", checked)
          }
          note={checkoutNote("pesapal", pesapal?.enabled)}
          badges={
            <>
              <StatusBadge configured={pesapalConfigured} />
              <ModeBadge mode={pesapalMode} />
            </>
          }
          testButton={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRegisterPesapalIpn()}
                disabled={
                  isSaving ||
                  isDirty ||
                  isTestingPayment ||
                  isRegisteringPesapalIpn
                }
              >
                {isRegisteringPesapalIpn ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Webhook className="mr-2 h-4 w-4" />
                )}
                {t("admin.settings.payment.pesapal.registerIpn")}
              </Button>
              {renderTestButton("pesapal", pesapal?.enabled ?? false)}
            </div>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="pesapalConsumerKey"
                label={t("admin.settings.payment.fields.consumerKey")}
                value={pesapal?.consumerKey || ""}
                onChange={(value) =>
                  updateNestedField("payment.pesapal.consumerKey", value)
                }
                onClear={() => updateNestedField("payment.pesapal.consumerKey", null)}
                secretSet={cred("payment.pesapal.consumerKey").set}
                maskedHint={cred("payment.pesapal.consumerKey").hint}
                placeholderWhenUnset={t("admin.settings.payment.pesapal.consumerKeyPlaceholder")}
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.pesapal.consumerKey)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="pesapalConsumerSecret"
                label={t("admin.settings.payment.fields.consumerSecret")}
                value={pesapal?.consumerSecret || ""}
                onChange={(value) =>
                  updateNestedField("payment.pesapal.consumerSecret", value)
                }
                onClear={() => updateNestedField("payment.pesapal.consumerSecret", null)}
                secretSet={cred("payment.pesapal.consumerSecret").set}
                maskedHint={cred("payment.pesapal.consumerSecret").hint}
                placeholderWhenUnset={t("admin.settings.payment.pesapal.consumerSecretPlaceholder")}
                helperText={t("admin.settings.fields.savedSecretsHint")}
              />
              <EnvSourceHint show={Boolean(env?.pesapal.consumerSecret)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pesapalMode">
                {t("admin.settings.payment.paypalMode")}
              </Label>
              <Select
                value={pesapalMode}
                onValueChange={(value) =>
                  updateNestedField("payment.pesapal.mode", value)
                }
              >
                <SelectTrigger id="pesapalMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    {t("admin.settings.payment.paypalSandbox")}
                  </SelectItem>
                  <SelectItem value="live">
                    {t("admin.settings.payment.paypalLive")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EnvSourceHint show={Boolean(env?.pesapal.mode)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="pesapalIpnId"
                label={t("admin.settings.payment.pesapal.ipnId")}
                value={pesapal?.ipnId || ""}
                onChange={(value) =>
                  updateNestedField("payment.pesapal.ipnId", value)
                }
                onClear={() => updateNestedField("payment.pesapal.ipnId", null)}
                secretSet={cred("payment.pesapal.ipnId").set}
                maskedHint={cred("payment.pesapal.ipnId").hint}
                placeholderWhenUnset={t("admin.settings.payment.pesapal.ipnIdPlaceholder")}
                revealTyped
              />
              <p className="text-xs text-muted-foreground">
                {t.rich("admin.settings.payment.pesapal.ipnHint", {
                  path: "/api/payments/pesapal/ipn",
                  code: (chunks) => <code>{chunks}</code>,
                })}
              </p>
              <EnvSourceHint show={Boolean(env?.pesapal.ipnId)} />
            </div>
          </div>
        </ProviderCard>

        {/* ioTec Pay */}
        <ProviderCard
          logo={<IotecLogo />}
          title="ioTec Pay"
          description={t("admin.settings.payment.iotec.description")}
          enabled={iotec?.enabled ?? false}
          onToggle={(checked) =>
            updateNestedField("payment.iotec.enabled", checked)
          }
          note={checkoutNote("iotec", iotec?.enabled)}
          badges={
            <>
              <StatusBadge configured={iotecConfigured} />
              <ModeBadge mode={iotecMode} />
            </>
          }
          testButton={renderTestButton("iotec", iotec?.enabled ?? false)}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="iotecClientId"
                label={t("admin.settings.payment.fields.clientId")}
                value={iotec?.clientId || ""}
                onChange={(value) =>
                  updateNestedField("payment.iotec.clientId", value)
                }
                onClear={() => updateNestedField("payment.iotec.clientId", null)}
                secretSet={cred("payment.iotec.clientId").set}
                maskedHint={cred("payment.iotec.clientId").hint}
                placeholderWhenUnset={t("admin.settings.payment.iotec.clientIdPlaceholder")}
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.iotec.clientId)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="iotecClientSecret"
                label={t("admin.settings.payment.fields.clientSecret")}
                value={iotec?.clientSecret || ""}
                onChange={(value) =>
                  updateNestedField("payment.iotec.clientSecret", value)
                }
                onClear={() => updateNestedField("payment.iotec.clientSecret", null)}
                secretSet={cred("payment.iotec.clientSecret").set}
                maskedHint={cred("payment.iotec.clientSecret").hint}
                placeholderWhenUnset={t("admin.settings.payment.iotec.clientSecretPlaceholder")}
                helperText={t("admin.settings.fields.savedSecretsHint")}
              />
              <EnvSourceHint show={Boolean(env?.iotec.clientSecret)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="iotecWalletId"
                label={t("admin.settings.payment.fields.walletId")}
                value={iotec?.walletId || ""}
                onChange={(value) =>
                  updateNestedField("payment.iotec.walletId", value)
                }
                onClear={() => updateNestedField("payment.iotec.walletId", null)}
                secretSet={cred("payment.iotec.walletId").set}
                maskedHint={cred("payment.iotec.walletId").hint}
                placeholderWhenUnset={t("admin.settings.payment.iotec.walletIdPlaceholder")}
                revealTyped
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.payment.iotec.walletIdHint")}
              </p>
              <EnvSourceHint show={Boolean(env?.iotec.walletId)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iotecMode">
                {t("admin.settings.payment.paypalMode")}
              </Label>
              <Select
                value={iotecMode}
                onValueChange={(value) =>
                  updateNestedField("payment.iotec.mode", value)
                }
              >
                <SelectTrigger id="iotecMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    {t("admin.settings.payment.paypalSandbox")}
                  </SelectItem>
                  <SelectItem value="live">
                    {t("admin.settings.payment.paypalLive")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EnvSourceHint show={Boolean(env?.iotec.mode)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t.rich("admin.settings.payment.iotec.callbackHint", {
              path: "/api/payments/iotec/callback",
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </ProviderCard>

        {/* Orange Money */}
        <ProviderCard
          logo={<OrangeMoneyLogo />}
          title="Orange Money"
          description={t("admin.settings.payment.orangeMoney.description")}
          enabled={orangeMoney?.enabled ?? false}
          onToggle={(checked) =>
            updateNestedField("payment.orange_money.enabled", checked)
          }
          note={checkoutNote("orange_money", orangeMoney?.enabled)}
          badges={
            <>
              <StatusBadge configured={orangeMoneyConfigured} />
              <ModeBadge mode={orangeMoneyMode} />
            </>
          }
          testButton={renderTestButton(
            "orange_money",
            orangeMoney?.enabled ?? false,
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="orangeMoneyClientId"
                label={t("admin.settings.payment.fields.clientId")}
                value={orangeMoney?.clientId || ""}
                onChange={(value) =>
                  updateNestedField("payment.orange_money.clientId", value)
                }
                onClear={() =>
                  updateNestedField("payment.orange_money.clientId", null)
                }
                secretSet={cred("payment.orange_money.clientId").set}
                maskedHint={cred("payment.orange_money.clientId").hint}
                placeholderWhenUnset={t("admin.settings.payment.orangeMoney.clientIdPlaceholder")}
                helperText={t("admin.settings.fields.savedKeysHint")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.orange_money.clientId)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="orangeMoneyClientSecret"
                label={t("admin.settings.payment.fields.clientSecret")}
                value={orangeMoney?.clientSecret || ""}
                onChange={(value) =>
                  updateNestedField("payment.orange_money.clientSecret", value)
                }
                onClear={() =>
                  updateNestedField("payment.orange_money.clientSecret", null)
                }
                secretSet={cred("payment.orange_money.clientSecret").set}
                maskedHint={cred("payment.orange_money.clientSecret").hint}
                placeholderWhenUnset={t("admin.settings.payment.orangeMoney.clientSecretPlaceholder")}
                helperText={t("admin.settings.fields.savedSecretsHint")}
              />
              <EnvSourceHint show={Boolean(env?.orange_money.clientSecret)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="orangeMoneyMerchantKey"
                label={t("admin.settings.payment.fields.merchantKey")}
                value={orangeMoney?.merchantKey || ""}
                onChange={(value) =>
                  updateNestedField("payment.orange_money.merchantKey", value)
                }
                onClear={() =>
                  updateNestedField("payment.orange_money.merchantKey", null)
                }
                secretSet={cred("payment.orange_money.merchantKey").set}
                maskedHint={cred("payment.orange_money.merchantKey").hint}
                placeholderWhenUnset={t("admin.settings.payment.orangeMoney.merchantKeyPlaceholder")}
                revealTyped
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.payment.orangeMoney.merchantKeyHint")}
              </p>
              <EnvSourceHint show={Boolean(env?.orange_money.merchantKey)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orangeMoneyMode">
                {t("admin.settings.payment.paypalMode")}
              </Label>
              <Select
                value={orangeMoneyMode}
                onValueChange={(value) =>
                  updateNestedField("payment.orange_money.mode", value)
                }
              >
                <SelectTrigger id="orangeMoneyMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    {t("admin.settings.payment.paypalSandbox")}
                  </SelectItem>
                  <SelectItem value="live">
                    {t("admin.settings.payment.paypalLive")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EnvSourceHint show={Boolean(env?.orange_money.mode)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="orangeMoneyCountry">
              {t("admin.settings.payment.fields.countryCode")}
            </Label>
            <Input
              id="orangeMoneyCountry"
              value={orangeMoney?.country || ""}
              placeholder="ci"
              maxLength={4}
              onChange={(e) =>
                updateNestedField(
                  "payment.orange_money.country",
                  e.target.value.trim().toLowerCase(),
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              {t.rich("admin.settings.payment.orangeMoney.countryHint", {
                endpoint: "dev",
                code: (chunks) => <code>{chunks}</code>,
              })}
            </p>
            <EnvSourceHint show={Boolean(env?.orange_money.country)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t.rich("admin.settings.payment.orangeMoney.callbackHint", {
              path: "/api/payments/orange-money/callback",
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </ProviderCard>

        {/* MTN MoMo */}
        <ProviderCard
          logo={<MtnMomoLogo />}
          title="MTN Mobile Money"
          description={t("admin.settings.payment.mtnMomo.description")}
          enabled={mtnMomo?.enabled ?? false}
          onToggle={(checked) =>
            updateNestedField("payment.mtn_momo.enabled", checked)
          }
          note={checkoutNote("mtn_momo", mtnMomo?.enabled)}
          badges={
            <>
              <StatusBadge configured={mtnMomoConfigured} />
              <ModeBadge mode={mtnMomoMode} />
            </>
          }
          testButton={renderTestButton("mtn_momo", mtnMomo?.enabled ?? false)}
        >
          <div className="space-y-2">
            <SecretInput
              id="mtnMomoSubscriptionKey"
              label={t("admin.settings.payment.fields.subscriptionKey")}
              value={mtnMomo?.subscriptionKey || ""}
              onChange={(value) =>
                updateNestedField("payment.mtn_momo.subscriptionKey", value)
              }
              onClear={() =>
                updateNestedField("payment.mtn_momo.subscriptionKey", null)
              }
              secretSet={cred("payment.mtn_momo.subscriptionKey").set}
              maskedHint={cred("payment.mtn_momo.subscriptionKey").hint}
              placeholderWhenUnset="Ocp-Apim-Subscription-Key (Collections)"
              helperText={t("admin.settings.payment.mtnMomo.subscriptionKeyHint")}
            />
            <EnvSourceHint show={Boolean(env?.mtn_momo.subscriptionKey)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SecretInput
                id="mtnMomoApiUser"
                label={t("admin.settings.payment.fields.apiUser")}
                value={mtnMomo?.apiUser || ""}
                onChange={(value) =>
                  updateNestedField("payment.mtn_momo.apiUser", value)
                }
                onClear={() =>
                  updateNestedField("payment.mtn_momo.apiUser", null)
                }
                secretSet={cred("payment.mtn_momo.apiUser").set}
                maskedHint={cred("payment.mtn_momo.apiUser").hint}
                placeholderWhenUnset={t("admin.settings.payment.mtnMomo.apiUserPlaceholder")}
                revealTyped
              />
              <EnvSourceHint show={Boolean(env?.mtn_momo.apiUser)} />
            </div>
            <div className="space-y-2">
              <SecretInput
                id="mtnMomoApiKey"
                label={t("admin.settings.payment.fields.apiKey")}
                value={mtnMomo?.apiKey || ""}
                onChange={(value) =>
                  updateNestedField("payment.mtn_momo.apiKey", value)
                }
                onClear={() =>
                  updateNestedField("payment.mtn_momo.apiKey", null)
                }
                secretSet={cred("payment.mtn_momo.apiKey").set}
                maskedHint={cred("payment.mtn_momo.apiKey").hint}
                placeholderWhenUnset={t("admin.settings.payment.mtnMomo.apiKeyPlaceholder")}
                helperText={t("admin.settings.fields.savedSecretsHint")}
              />
              <EnvSourceHint show={Boolean(env?.mtn_momo.apiKey)} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mtnMomoTargetEnvironment">
                {t("admin.settings.payment.fields.targetEnvironment")}
              </Label>
              <Input
                id="mtnMomoTargetEnvironment"
                value={mtnMomo?.targetEnvironment || ""}
                placeholder="mtnuganda"
                maxLength={32}
                onChange={(e) =>
                  updateNestedField(
                    "payment.mtn_momo.targetEnvironment",
                    e.target.value.trim().toLowerCase(),
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                {t.rich("admin.settings.payment.mtnMomo.targetEnvironmentHint", {
                  value: "sandbox",
                  code: (chunks) => <code>{chunks}</code>,
                })}
              </p>
              <EnvSourceHint show={Boolean(env?.mtn_momo.targetEnvironment)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mtnMomoMode">
                {t("admin.settings.payment.paypalMode")}
              </Label>
              <Select
                value={mtnMomoMode}
                onValueChange={(value) =>
                  updateNestedField("payment.mtn_momo.mode", value)
                }
              >
                <SelectTrigger id="mtnMomoMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    {t("admin.settings.payment.paypalSandbox")}
                  </SelectItem>
                  <SelectItem value="live">
                    {t("admin.settings.payment.paypalLive")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EnvSourceHint show={Boolean(env?.mtn_momo.mode)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mtnMomoCallbackHost">
              {t("admin.settings.payment.fields.callbackHost")}
            </Label>
            <Input
              id="mtnMomoCallbackHost"
              value={mtnMomo?.callbackHost || ""}
              placeholder="your-domain.com"
              onChange={(e) =>
                updateNestedField(
                  "payment.mtn_momo.callbackHost",
                  e.target.value.trim().toLowerCase(),
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              {t.rich("admin.settings.payment.mtnMomo.callbackHostHint", {
                scheme: "https://",
                code: (chunks) => <code>{chunks}</code>,
              })}
            </p>
            <EnvSourceHint show={Boolean(env?.mtn_momo.callbackHost)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t.rich("admin.settings.payment.mtnMomo.callbackHint", {
              path: "/api/payments/mtn-momo/callback",
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </ProviderCard>

        {/* Cash on Delivery */}
        <ProviderCard
          logo={
            <CashOnDeliveryLogo label={t("admin.settings.payment.cod.title")} />
          }
          title={t("admin.settings.payment.cod.title")}
          description={t("admin.settings.payment.cod.description")}
          enabled={cod?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.cod.enabled", c)}
          badges={
            <Badge variant="outline" className="gap-1">
              <Banknote className="h-3 w-3" />
              {t("admin.settings.payment.cod.offline")}
            </Badge>
          }
        >
          <div className="space-y-2">
            <Label htmlFor="codInstructions">
              {t("admin.settings.payment.codInstructions")}
            </Label>
            <Textarea
              id="codInstructions"
              value={cod?.instructions || ""}
              onChange={(e) =>
                updateNestedField("payment.cod.instructions", e.target.value)
              }
              rows={3}
              placeholder={t("admin.settings.payment.cod.placeholder")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="codMinOrder">
                {t("admin.settings.payment.codMinOrder")}
              </Label>
              <NumberInput
                id="codMinOrder"
                min={0}
                step="0.01"
                value={cod?.minOrderAmount || 0}
                whenEmpty={0}
                onValueChange={(next) =>
                  updateNestedField("payment.cod.minOrderAmount", next ?? 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="codMaxOrder">
                {t("admin.settings.payment.codMaxOrder")}
              </Label>
              <NumberInput
                id="codMaxOrder"
                min={0}
                step="0.01"
                value={cod?.maxOrderAmount || 0}
                whenEmpty={0}
                onValueChange={(next) =>
                  updateNestedField("payment.cod.maxOrderAmount", next ?? 0)
                }
              />
            </div>
          </div>
        </ProviderCard>

        {/* Card-testing check (Cloudflare Turnstile) */}
        <ProviderCard
          logo={<TurnstileLogo />}
          title={t("admin.settings.payment.turnstile.title")}
          description={t("admin.settings.payment.turnstile.description")}
          enabled={turnstile?.enabled ?? false}
          onToggle={(c) => updateNestedField("payment.turnstile.enabled", c)}
          note={
            // A switch without both keys asks for nothing: the check reads a
            // missing key as "not configured" rather than turning shoppers
            // away (`lib/checkout/turnstile.ts`).
            turnstile?.enabled &&
            !(
              turnstile.siteKey &&
              (turnstile.secretKey || cred("payment.turnstile.secretKey").set)
            )
              ? t("admin.settings.payment.turnstile.missingKeys")
              : undefined
          }
        >
          <p className="text-xs text-muted-foreground">
            {t("admin.settings.payment.turnstile.explainer")}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="turnstileSiteKey">
                {t("admin.settings.payment.turnstile.siteKey")}
              </Label>
              <Input
                id="turnstileSiteKey"
                value={turnstile?.siteKey || ""}
                onChange={(e) =>
                  updateNestedField("payment.turnstile.siteKey", e.target.value)
                }
                placeholder="0x4AAAAAAA..."
                autoComplete="off"
              />
            </div>
            <SecretInput
              id="turnstileSecretKey"
              label={t("admin.settings.payment.turnstile.secretKey")}
              value={turnstile?.secretKey || ""}
              onChange={(v) => updateNestedField("payment.turnstile.secretKey", v)}
              onClear={() => updateNestedField("payment.turnstile.secretKey", null)}
              secretSet={cred("payment.turnstile.secretKey").set}
              maskedHint={cred("payment.turnstile.secretKey").hint}
              placeholderWhenUnset="0x4AAAAAAA..."
              helperText={t("admin.settings.fields.savedKeysHint")}
            />
          </div>
        </ProviderCard>
      </div>

      <StickySaveFooter
        label={t("admin.settings.general.save")}
        isSaving={isSaving}
        isDirty={isDirty}
        onSave={onSave}
      />
    </div>
  );
}
