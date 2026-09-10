"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { FacebookGlyph } from "@/components/ui/brand-glyphs";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export interface EmbeddedSignupConfig {
  configured: boolean;
  appId: string;
  configurationId: string;
  graphVersion: string;
  state?: string;
  providers?: {
    whatsapp: { configured: boolean; configurationId: string };
    instagram: { configured: boolean; configurationId: string };
  };
}

interface SignupInfo {
  businessAccountId?: string;
  phoneNumberId?: string;
}

interface WhatsAppEmbeddedSignupButtonProps {
  disabled?: boolean;
  onConnected: () => Promise<void>;
}

type FacebookSDK = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: {
      authResponse?: { code?: string };
      status?: string;
    }) => void,
    options: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSDK;
  }
}

/**
 * Localized failure messages for {@link loadFacebookSDK}. The loader is a plain
 * function and cannot call hooks, so callers pass the already-translated text in.
 */
interface FacebookSDKMessages {
  /** Shown when the SDK script itself fails to download. */
  loadFailed: string;
  /** Shown when the script loads but `window.FB` never appears. */
  initFailed: string;
}

/**
 * One shared script load for the whole panel: the WhatsApp and Instagram buttons
 * render side by side, so each would otherwise race the other's <script> tag.
 */
let sdkScript: Promise<void> | undefined;

function loadSdkScript(messages: FacebookSDKMessages) {
  sdkScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(messages.loadFailed));
    document.body.appendChild(script);
  }).catch((error: unknown) => {
    // Forget the failed attempt and drop the dead tag. An ad blocker swallowing
    // the first load is common, and leaving either behind meant every later
    // click awaited a `load` event that had already fired and never would again
    // — the button span forever with no error to explain it.
    sdkScript = undefined;
    document.getElementById("facebook-jssdk")?.remove();
    throw error;
  });
  return sdkScript;
}

export async function loadFacebookSDK(
  config: {
    appId: string;
    graphVersion: string;
  },
  messages: FacebookSDKMessages,
) {
  if (!window.FB) await loadSdkScript(messages);
  if (!window.FB) throw new Error(messages.initFailed);
  window.FB.init({
    appId: config.appId,
    cookie: true,
    xfbml: false,
    version: config.graphVersion,
  });
  return window.FB;
}

export function WhatsAppEmbeddedSignupButton({
  disabled = false,
  onConnected,
}: WhatsAppEmbeddedSignupButtonProps) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  const [config, setConfig] = useState<EmbeddedSignupConfig>();
  const [working, setWorking] = useState(false);
  const signupInfo = useRef<SignupInfo>({});

  useEffect(() => {
    void fetch("/api/chat/channels/embedded-signup")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.success) setConfig(payload.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        ![
          "https://www.facebook.com",
          "https://web.facebook.com",
        ].includes(event.origin)
      ) {
        return;
      }
      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (
        payload?.type !== "WA_EMBEDDED_SIGNUP" ||
        payload?.event !== "FINISH"
      ) {
        return;
      }
      signupInfo.current = {
        businessAccountId:
          payload.data?.waba_id || payload.data?.business_account_id,
        phoneNumberId: payload.data?.phone_number_id,
      };
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  if (!config?.configured) return null;

  const start = async () => {
    if (!config.state || working) return;
    setWorking(true);
    signupInfo.current = {};
    try {
      const sdk = await loadFacebookSDK(config, {
        loadFailed: tr("signup.sdkFailed", "Unable to load Facebook SDK"),
        initFailed: tr("signup.sdkInitFailed", "Facebook SDK did not initialize"),
      });
      const response = await new Promise<{
        authResponse?: { code?: string };
      }>((resolve) =>
        sdk.login(resolve, {
          config_id: config.configurationId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} },
        }),
      );
      const code = response.authResponse?.code;
      const businessAccountId = signupInfo.current.businessAccountId;
      const phoneNumberId = signupInfo.current.phoneNumberId;
      if (!code || !businessAccountId || !phoneNumberId) {
        throw new Error(
          tr(
            "signup.whatsappMissingDetails",
            "WhatsApp onboarding did not return the required account details",
          ),
        );
      }
      const completion = await fetch("/api/chat/channels/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "whatsapp",
          code,
          state: config.state,
          businessAccountId,
          phoneNumberId,
        }),
      });
      const payload = await completion.json().catch(() => null);
      if (!completion.ok || !payload?.success) {
        throw new Error(
          payload?.message || tr("channelConnections.connectFailed", "Unable to connect channel"),
        );
      }
      toast.success(
        tr("signup.whatsappConnected", "WhatsApp connected through Embedded Signup"),
      );
      await onConnected();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("signup.whatsappFailed", "Unable to complete WhatsApp signup"),
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p className="font-medium">
          {tr("signup.whatsappTitle", "Recommended: Meta Embedded Signup")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(
            "signup.whatsappHint",
            "Let Meta securely select and authorize the WhatsApp Business Account and phone number. No access token is pasted into Storify.",
          )}
        </p>
        <Button
          type="button"
          className="mt-3"
          disabled={disabled || working}
          onClick={() => void start()}
        >
          {working ? (
            <Loader2 className="animate-spin" />
          ) : (
            // The action is Facebook's, so the mark is Facebook's — a generic
            // speech bubble here said nothing about what the button does.
            <FacebookGlyph className="size-4" />
          )}
          {tr("signup.continue", "Continue with Facebook")}
        </Button>
      </div>
      {/*
        The separator belongs to this block, not to the panel. Left there, it
        still rendered when Embedded Signup was unconfigured and this component
        returned null — heading the tab with "or connect manually" when there was
        nothing above it to be an alternative to.
      */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        {tr("channelConnections.orConnectManually", "or connect manually")}
      </div>
    </>
  );
}
