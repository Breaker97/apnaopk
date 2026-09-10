"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { FacebookGlyph } from "@/components/ui/brand-glyphs";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import {
  loadFacebookSDK,
  type EmbeddedSignupConfig,
} from "@/components/chat/whatsapp-embedded-signup-button";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface InstagramConnectButtonProps {
  disabled?: boolean;
  onConnected: () => Promise<void>;
}

/**
 * Instagram onboarding through Facebook Login for Business.
 *
 * Unlike WhatsApp Embedded Signup, Meta sends no account details back over
 * postMessage here — Instagram Direct is reached through a Facebook Page, so the
 * server discovers the Page and its linked Instagram professional account from
 * the returned code. The browser only ever holds the short-lived code.
 */
export function InstagramConnectButton({
  disabled = false,
  onConnected,
}: InstagramConnectButtonProps) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  const [config, setConfig] = useState<EmbeddedSignupConfig>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch("/api/chat/channels/embedded-signup")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.success) setConfig(payload.data);
      })
      .catch(() => undefined);
  }, []);

  const instagram = config?.providers?.instagram;
  if (!instagram?.configured || !config?.state) return null;

  const start = async () => {
    if (working) return;
    setWorking(true);
    try {
      const sdk = await loadFacebookSDK(config, {
        loadFailed: tr("signup.sdkFailed", "Unable to load Facebook SDK"),
        initFailed: tr("signup.sdkInitFailed", "Facebook SDK did not initialize"),
      });
      const response = await new Promise<{
        authResponse?: { code?: string };
      }>((resolve) =>
        sdk.login(resolve, {
          config_id: instagram.configurationId,
          response_type: "code",
          override_default_response_type: true,
        }),
      );
      const code = response.authResponse?.code;
      if (!code) throw new Error(tr("signup.instagramCancelled", "Facebook login was cancelled"));
      const completion = await fetch("/api/chat/channels/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "instagram",
          code,
          state: config.state,
        }),
      });
      const payload = await completion.json().catch(() => null);
      if (!completion.ok || !payload?.success) {
        // The server lists the eligible Pages when there is more than one, so
        // its message is more useful than a generic failure.
        throw new Error(
          payload?.message ||
            tr("channelConnections.connectFailed", "Unable to connect channel"),
        );
      }
      toast.success(tr("signup.instagramConnected", "Instagram connected"));
      await onConnected();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("signup.instagramFailed", "Unable to complete Instagram signup"),
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-4">
      <p className="font-medium">
        {tr("signup.instagramTitle", "Recommended: continue with Facebook")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr(
          "signup.instagramHint",
          "Meta authorizes the Facebook Page linked to your Instagram professional account and Storify subscribes it to messaging webhooks. No access token is pasted into Storify.",
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
          // Facebook's mark, not Instagram's: Meta authorizes the linked Page,
          // and the label already says so.
          <FacebookGlyph className="size-4" />
        )}
        {tr("signup.continue", "Continue with Facebook")}
      </Button>
    </div>
  );
}
