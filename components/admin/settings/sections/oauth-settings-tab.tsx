"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FacebookIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import type { Settings } from "@/components/admin/settings/types";
import { SecretInput } from "@/components/admin/settings/fields/secret-input";
import { useCredentialMeta } from "@/components/admin/settings/fields/use-credential-meta";
import { EnvSourceHint } from "@/components/admin/settings/fields/env-source-hint";
import {
  ProviderCard,
  StatusBadge,
} from "@/components/admin/settings/fields/provider-card";
import {
  buildOAuthCallbackUrl,
  type OAuthProviderId,
} from "@/lib/auth/oauth-callback";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";

type TSafe = (
  key: string,
  fallback: string,
  values?: Record<string, unknown>,
) => string;

/**
 * `window.location.origin`, read without tripping hydration: the server has no
 * origin to render, so it starts empty and settles on the real one on the
 * client. Only used to *compare* against the configured base URL — the URLs an
 * admin copies always come from the server's own value.
 */
const subscribeToNothing = () => () => {};
const readBrowserOrigin = () => window.location.origin;
const readNoOrigin = () => "";

/** Where an admin goes to mint the credentials this screen asks for. */
const CONSOLE_URLS = {
  google: "https://console.cloud.google.com/apis/credentials",
  facebook: "https://developers.facebook.com/apps",
} as const satisfies Record<OAuthProviderId, string>;

export function OAuthSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isTestingOAuth?: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onVerify?: (provider: OAuthProviderId) => void | Promise<unknown>;
}) {
  const t = useTranslations();
  const security = props.settings.security;
  const env = props.settings._meta?.envSources?.security;
  const cred = useCredentialMeta(props.settings);

  const tSafe: TSafe = (key, fallback, values) => {
    try {
      const translate = t as unknown as (
        k: string,
        v?: Record<string, unknown>,
      ) => string;
      const res = translate(key, values);
      return typeof res === "string" && res !== key ? res : fallback;
    } catch {
      return fallback;
    }
  };

  // The server publishes the origin Better Auth actually signs in through
  // (BETTER_AUTH_URL → NEXT_PUBLIC_APP_URL). Only fall back to the browser's own
  // origin when that is missing, so a store reached through a preview domain
  // still shows the URL the provider will really be handed.
  const configuredOrigin = props.settings._meta?.authBaseUrl || "";
  const browserOrigin = useSyncExternalStore(
    subscribeToNothing,
    readBrowserOrigin,
    readNoOrigin,
  );
  const origin = configuredOrigin || browserOrigin;
  const originMismatch = Boolean(
    configuredOrigin && browserOrigin && configuredOrigin !== browserOrigin,
  );

  const googleEnabled = Boolean(security.googleOAuthEnabled);
  const facebookEnabled = Boolean(security.facebookOAuthEnabled);

  const googleConfigured =
    (cred("security.googleClientId").set || Boolean(env?.googleClientId)) &&
    (cred("security.googleClientSecret").set ||
      Boolean(env?.googleClientSecret));
  const facebookConfigured =
    (cred("security.facebookAppId").set || Boolean(env?.facebookAppId)) &&
    (cred("security.facebookAppSecret").set ||
      Boolean(env?.facebookAppSecret));

  const enabledCount = [googleEnabled, facebookEnabled].filter(Boolean).length;

  // Shown on a switched-off provider that already has `.env` credentials, which
  // otherwise looks like nothing is configured at all. `ProviderCard` wraps the
  // note in its own paragraph, so this stays a string rather than `EnvSourceHint`.
  const envNote = tSafe(
    "admin.settings.oauth.envCredentials",
    "Credentials for this provider are set via environment variables — turn it on to use them.",
  );

  const verifyButton = (provider: OAuthProviderId, configured: boolean) => {
    if (!props.onVerify) return null;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => props.onVerify?.(provider)}
        disabled={props.isSaving || props.isTestingOAuth || !configured}
      >
        {props.isTestingOAuth ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-2 h-4 w-4" />
        )}
        {tSafe("admin.settings.oauth.verify", "Verify credentials")}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={t("admin.settings.oauth.title")}
        description={t("admin.settings.oauth.description")}
        meta={
          <Badge variant="secondary">
            {tSafe("admin.settings.oauth.activeCount", `${enabledCount} active`, {
              count: enabledCount,
            })}
          </Badge>
        }
      />

      {originMismatch ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {tSafe(
            "admin.settings.oauth.originMismatch",
            `You are browsing on ${browserOrigin}, but sign-in runs on ${configuredOrigin}. Register the URLs shown below — or point BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL at the domain you actually use.`,
            { browser: browserOrigin, configured: configuredOrigin },
          )}
        </p>
      ) : null}

      <ProviderCard
        logo={<GoogleIcon className="h-8 w-8" />}
        title={t("admin.settings.oauth.google.label")}
        description={t("admin.settings.oauth.google.description")}
        enabled={googleEnabled}
        onToggle={(v) => props.updateField("security.googleOAuthEnabled", v)}
        badges={<StatusBadge configured={googleConfigured} />}
        note={
          !googleEnabled && (env?.googleClientId || env?.googleClientSecret)
            ? envNote
            : null
        }
        testButton={verifyButton("google", googleConfigured)}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <SecretInput
              id="googleClientId"
              label={t("admin.settings.oauth.google.clientId")}
              value={security.googleClientId || ""}
              onChange={(v) => props.updateField("security.googleClientId", v)}
              onClear={() => props.updateField("security.googleClientId", null)}
              secretSet={cred("security.googleClientId").set}
              maskedHint={cred("security.googleClientId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset="1234567890-abc.apps.googleusercontent.com"
              helperText="Saved keys are not shown again for security."
              revealTyped
            />
            <EnvSourceHint show={Boolean(env?.googleClientId)} />
          </div>
          <div className="space-y-2">
            <SecretInput
              id="googleClientSecret"
              label={t("admin.settings.oauth.google.clientSecret")}
              value={security.googleClientSecret || ""}
              onChange={(v) =>
                props.updateField("security.googleClientSecret", v)
              }
              onClear={() =>
                props.updateField("security.googleClientSecret", null)
              }
              secretSet={cred("security.googleClientSecret").set}
              maskedHint={cred("security.googleClientSecret").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset="GOCSPX-..."
              helperText="Saved secrets are not shown again for security."
            />
            <EnvSourceHint show={Boolean(env?.googleClientSecret)} />
          </div>
        </div>

        <RedirectUriBlock
          tSafe={tSafe}
          provider="google"
          origin={origin}
          showJavaScriptOrigin
        />

        <SetupGuide
          tSafe={tSafe}
          provider="google"
          configured={googleConfigured}
          consoleLabel={tSafe(
            "admin.settings.oauth.google.openConsole",
            "Open Google Cloud Console",
          )}
          steps={googleSteps(tSafe, origin)}
        />
      </ProviderCard>

      <ProviderCard
        logo={<FacebookIcon className="h-8 w-8" />}
        title={t("admin.settings.oauth.facebook.label")}
        description={t("admin.settings.oauth.facebook.description")}
        enabled={facebookEnabled}
        onToggle={(v) => props.updateField("security.facebookOAuthEnabled", v)}
        badges={<StatusBadge configured={facebookConfigured} />}
        note={
          !facebookEnabled && (env?.facebookAppId || env?.facebookAppSecret)
            ? envNote
            : null
        }
        testButton={verifyButton("facebook", facebookConfigured)}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <SecretInput
              id="facebookAppId"
              label={t("admin.settings.oauth.facebook.appId")}
              value={security.facebookAppId || ""}
              onChange={(v) => props.updateField("security.facebookAppId", v)}
              onClear={() => props.updateField("security.facebookAppId", null)}
              secretSet={cred("security.facebookAppId").set}
              maskedHint={cred("security.facebookAppId").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              placeholderWhenUnset="Facebook app ID"
              helperText="Saved keys are not shown again for security."
              revealTyped
            />
            <EnvSourceHint show={Boolean(env?.facebookAppId)} />
          </div>
          <div className="space-y-2">
            <SecretInput
              id="facebookAppSecret"
              label={t("admin.settings.oauth.facebook.appSecret")}
              value={security.facebookAppSecret || ""}
              onChange={(v) =>
                props.updateField("security.facebookAppSecret", v)
              }
              onClear={() =>
                props.updateField("security.facebookAppSecret", null)
              }
              secretSet={cred("security.facebookAppSecret").set}
              maskedHint={cred("security.facebookAppSecret").hint}
              placeholderWhenSet="Saved (leave blank to keep)"
              helperText="Saved secrets are not shown again for security."
            />
            <EnvSourceHint show={Boolean(env?.facebookAppSecret)} />
          </div>
        </div>

        <RedirectUriBlock tSafe={tSafe} provider="facebook" origin={origin} />

        <SetupGuide
          tSafe={tSafe}
          provider="facebook"
          configured={facebookConfigured}
          consoleLabel={tSafe(
            "admin.settings.oauth.facebook.openConsole",
            "Open Meta for Developers",
          )}
          steps={facebookSteps(tSafe, origin)}
        />
      </ProviderCard>

      <StickySaveFooter
        label={t("admin.settings.oauth.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={props.onSave}
      />
    </div>
  );
}

/**
 * The redirect URI the provider has to have on file, plus — for Google — the
 * JavaScript origin its console asks for on the same form.
 *
 * Both providers compare the redirect URI they receive against the registered
 * one character for character, so this is a copy button rather than something
 * an admin retypes, and it is built from the server's own base URL rather than
 * from `window.location`.
 */
function RedirectUriBlock(props: {
  tSafe: TSafe;
  provider: OAuthProviderId;
  origin: string;
  showJavaScriptOrigin?: boolean;
}) {
  const { tSafe, origin, provider } = props;
  if (!origin) return null;

  const callbackUrl = buildOAuthCallbackUrl(origin, provider);
  const isHttps = /^https:\/\//i.test(origin);
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(
    origin,
  );
  // Google accepts `http://localhost` for development and nothing else
  // unencrypted; Meta accepts neither, so a store still on localhost has to
  // finish this step from its live domain or an HTTPS tunnel.
  const usable = provider === "google" ? isHttps || isLocalhost : isHttps;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <CopyableUrl
        tSafe={tSafe}
        id={`${provider}-redirect-uri`}
        label={tSafe(
          "admin.settings.oauth.redirectUri",
          "Authorized redirect URI",
        )}
        value={callbackUrl}
      />
      {props.showJavaScriptOrigin ? (
        <CopyableUrl
          tSafe={tSafe}
          id={`${provider}-js-origin`}
          label={tSafe(
            "admin.settings.oauth.javascriptOrigin",
            "Authorized JavaScript origin",
          )}
          value={origin}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {tSafe(
          "admin.settings.oauth.redirectUriHint",
          "Paste this into the provider's console exactly as shown — sign-in is rejected on any difference, including a trailing slash.",
        )}
      </p>
      {usable ? null : (
        <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {provider === "google"
            ? tSafe(
                "admin.settings.oauth.httpsRequiredGoogle",
                "Google only accepts an HTTPS redirect URI (http://localhost is the one exception). Open this page on your live domain before registering it.",
              )
            : tSafe(
                "admin.settings.oauth.httpsRequiredFacebook",
                "Meta only accepts a public HTTPS redirect URI — localhost is refused. Open this page on your live domain, or an HTTPS tunnel, before registering it.",
              )}
        </p>
      )}
    </div>
  );
}

function CopyableUrl(props: {
  tSafe: TSafe;
  id: string;
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        props.tSafe("admin.settings.oauth.copyFailed", "Unable to copy the URL"),
      );
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex gap-2">
        <Input
          id={props.id}
          value={props.value}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void copy()}
          aria-label={props.tSafe("admin.settings.oauth.copy", "Copy")}
        >
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Collapsed once the provider is configured, open while it is not — the steps
 * matter exactly once, and the credentials above are what an admin returns for.
 */
function SetupGuide(props: {
  tSafe: TSafe;
  provider: OAuthProviderId;
  configured: boolean;
  consoleLabel: string;
  steps: ReactNode[];
}) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={props.configured ? undefined : "guide"}
      className="rounded-lg border px-4"
    >
      <AccordionItem value="guide">
        <AccordionTrigger className="text-sm">
          {props.tSafe(
            "admin.settings.oauth.setupGuide",
            "How to set this up (step by step)",
          )}
        </AccordionTrigger>
        <AccordionContent className="space-y-4">
          <Button asChild type="button" variant="outline" size="sm">
            <a
              href={CONSOLE_URLS[props.provider]}
              target="_blank"
              rel="noopener noreferrer"
            >
              {props.provider === "google" ? (
                <GoogleIcon className="mr-2 h-4 w-4" />
              ) : (
                <FacebookIcon className="mr-2 h-4 w-4" />
              )}
              {props.consoleLabel}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
          <ol className="list-decimal space-y-2 pl-5 text-xs text-muted-foreground marker:text-foreground">
            {props.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {props.tSafe(
              "admin.settings.oauth.verifyHint",
              "Verify credentials checks the ID and secret with the provider. Whether the redirect URI is registered can only be proven by a real sign-in.",
            )}
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Rendered inside the steps so a URL is never mistaken for prose. */
function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all text-foreground">
      {children}
    </code>
  );
}

function googleSteps(tSafe: TSafe, origin: string): ReactNode[] {
  const callbackUrl = origin ? buildOAuthCallbackUrl(origin, "google") : "";
  return [
    tSafe(
      "admin.settings.oauth.google.step1",
      "Open the Google Cloud Console and select an existing project, or create one for this store.",
    ),
    tSafe(
      "admin.settings.oauth.google.step2",
      "Under APIs & Services → OAuth consent screen, fill in the app name, support email and authorized domain, then publish the app. While it stays in Testing, only the test users you list can sign in.",
    ),
    tSafe(
      "admin.settings.oauth.google.step3",
      "Go to Credentials → Create credentials → OAuth client ID and choose Web application as the type.",
    ),
    <span key="origin">
      {tSafe(
        "admin.settings.oauth.google.step4",
        "Under Authorized JavaScript origins, add:",
      )}{" "}
      <Mono>{origin}</Mono>
    </span>,
    <span key="redirect">
      {tSafe(
        "admin.settings.oauth.google.step5",
        "Under Authorized redirect URIs, add:",
      )}{" "}
      <Mono>{callbackUrl}</Mono>
    </span>,
    tSafe(
      "admin.settings.oauth.google.step6",
      "Copy the Client ID and Client secret into the fields above, save, then press Verify credentials. New Google clients can take a few minutes to become active.",
    ),
  ];
}

function facebookSteps(tSafe: TSafe, origin: string): ReactNode[] {
  const callbackUrl = origin ? buildOAuthCallbackUrl(origin, "facebook") : "";
  let host = "";
  try {
    host = origin ? new URL(origin).hostname : "";
  } catch {
    host = "";
  }

  return [
    tSafe(
      "admin.settings.oauth.facebook.step1",
      "Open Meta for Developers → My Apps → Create app, and pick the use case “Authenticate and request data from users with Facebook Login”.",
    ),
    tSafe(
      "admin.settings.oauth.facebook.step2",
      "Add the Facebook Login product to the app, then open Facebook Login → Settings.",
    ),
    <span key="redirect">
      {tSafe(
        "admin.settings.oauth.facebook.step3",
        "Turn on Client OAuth login and Web OAuth login, and add this under Valid OAuth Redirect URIs:",
      )}{" "}
      <Mono>{callbackUrl}</Mono>
    </span>,
    <span key="basic">
      {tSafe(
        "admin.settings.oauth.facebook.step4",
        "In App settings → Basic, set the Site URL to",
      )}{" "}
      <Mono>{origin}</Mono>
      {host ? (
        <>
          {" "}
          {tSafe("admin.settings.oauth.facebook.step4b", "and add")}{" "}
          <Mono>{host}</Mono>{" "}
          {tSafe(
            "admin.settings.oauth.facebook.step4c",
            "under App domains. A Privacy Policy URL is also required before Meta will let the app go live.",
          )}
        </>
      ) : null}
    </span>,
    tSafe(
      "admin.settings.oauth.facebook.step5",
      "Copy the App ID and App Secret into the fields above, save, then press Verify credentials.",
    ),
    tSafe(
      "admin.settings.oauth.facebook.step6",
      "Switch the app from Development to Live. Until you do, only people with a role on the app can sign in with Facebook.",
    ),
  ];
}
