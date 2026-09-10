"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  InstagramGlyph,
  MessengerGlyph,
  TelegramGlyph,
  WhatsAppGlyph,
} from "@/components/ui/brand-glyphs";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { WhatsAppTemplateAuthoring } from "@/components/chat/whatsapp-template-authoring";
import { DeliveryFailuresPanel } from "@/components/chat/delivery-failures-panel";
import { WhatsAppEmbeddedSignupButton } from "@/components/chat/whatsapp-embedded-signup-button";
import { InstagramConnectButton } from "@/components/chat/instagram-connect-button";
import { channelLabel } from "@/lib/conversations/channels";
import type { MessageProvider } from "@/models/channel-connection.model";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface ChannelConnectionDTO {
  _id: string;
  provider: MessageProvider;
  status: "pending" | "active" | "error" | "revoked";
  displayName: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  pageId?: string;
  instagramUserId?: string;
  telegramBotId?: string;
  publicPhoneNumberE164?: string;
  publicPageUsername?: string;
  publicInstagramUsername?: string;
  publicTelegramUsername?: string;
  messengerHumanAgentEnabled?: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
}

/**
 * The account identifier to show for a connected channel. Every provider names
 * its account differently, and reading only WhatsApp's and Messenger's left the
 * Instagram and Telegram cards showing a blank line.
 */
function accountIdentifier(connection: ChannelConnectionDTO) {
  return (
    connection.phoneNumberId ||
    connection.pageId ||
    connection.instagramUserId ||
    connection.telegramBotId
  );
}

/** The storefront click-to-chat target, mirroring lib/vendor-messaging.ts. */
function publicContact(connection: ChannelConnectionDTO) {
  if (connection.publicPhoneNumberE164) return connection.publicPhoneNumberE164;
  if (connection.publicPageUsername) {
    return `m.me/${connection.publicPageUsername}`;
  }
  if (connection.publicInstagramUsername) {
    return `ig.me/m/${connection.publicInstagramUsername}`;
  }
  if (connection.publicTelegramUsername) {
    return `t.me/${connection.publicTelegramUsername}`;
  }
  return undefined;
}

/**
 * The tab strip's own description of each channel.
 *
 * `webhook` is the load-bearing one: it says whether the channel is reached
 * through the shared Meta callback URL. Telegram is registered server-side from
 * the bot token, so showing it that field only invited people to paste it
 * somewhere it does not belong — the field now follows this flag rather than
 * sitting above the tabs for everyone.
 */
const CHANNEL_TABS = [
  {
    value: "whatsapp",
    label: "WhatsApp",
    icon: WhatsAppGlyph,
    // The provider's own mark in its own colour, the way the OAuth panel shows
    // Google and Facebook. It stays branded whether or not the tab is selected —
    // a logo that changes colour with selection stops reading as a logo.
    brand: "text-[#25D366]",
    webhook: true,
    accent:
      "data-[state=active]:border-emerald-500/40 data-[state=active]:bg-emerald-500/10",
  },
  {
    value: "messenger",
    label: "Messenger",
    icon: MessengerGlyph,
    brand: "text-[#0084FF]",
    webhook: true,
    accent:
      "data-[state=active]:border-blue-500/40 data-[state=active]:bg-blue-500/10",
  },
  {
    value: "instagram",
    label: "Instagram",
    icon: InstagramGlyph,
    brand: "text-[#E4405F]",
    webhook: true,
    accent:
      "data-[state=active]:border-pink-500/40 data-[state=active]:bg-pink-500/10",
  },
  {
    value: "telegram",
    label: "Telegram",
    icon: TelegramGlyph,
    brand: "text-[#229ED9]",
    webhook: false,
    accent:
      "data-[state=active]:border-sky-500/40 data-[state=active]:bg-sky-500/10",
  },
] as const;

type ChannelTabValue = (typeof CHANNEL_TABS)[number]["value"];

/**
 * The in-panel setup guide for each channel.
 *
 * Every one of these steps is Meta (or Telegram) account configuration that no
 * amount of code can do for the operator, and getting one wrong fails much later
 * with a provider error that names none of them — the redirect-URI complaint on
 * Instagram being the standing example. `docs/OMNICHANNEL_MESSAGING.md` carries
 * the long form; this is the checklist you need while looking at the form.
 *
 * `code` holds literal identifiers — permission names, webhook objects,
 * environment variables. They are deliberately outside the translated sentence:
 * Meta does not localise them, and a translator "fixing" `pages_messaging` would
 * silently break the instruction.
 */
interface ChannelSetupStep {
  key: string;
  fallback: string;
  code?: string;
}

const CHANNEL_SETUP: Record<
  ChannelTabValue,
  { steps: ChannelSetupStep[]; caution?: { key: string; fallback: string } }
> = {
  whatsapp: {
    steps: [
      {
        key: "setup.whatsapp.app",
        fallback: "Create a Meta app and add the WhatsApp product to it.",
      },
      {
        key: "setup.whatsapp.config",
        fallback:
          "Create a Facebook Login for Business configuration granting these permissions, and put its ID in META_WHATSAPP_CONFIGURATION_ID.",
        code: "whatsapp_business_management, whatsapp_business_messaging",
      },
      {
        key: "setup.whatsapp.oauth",
        fallback:
          "In that configuration's settings, add this site's domain to Allowed Domains for the JavaScript SDK and this page's full URL to Valid OAuth Redirect URIs.",
      },
      {
        key: "setup.whatsapp.webhook",
        fallback:
          "Under Webhooks, register the callback URL shown on this page with your META_WEBHOOK_VERIFY_TOKEN and subscribe these fields.",
        code: "whatsapp_business_account → messages, message_template_status_update",
      },
      {
        key: "setup.whatsapp.connect",
        fallback:
          "Use Continue with Facebook, or fill in the account IDs and access token in the form on this page.",
      },
    ],
    caution: {
      key: "setup.whatsapp.caution",
      fallback:
        "Meta requires business verification and a registered phone number before anyone outside your app's test users can message you.",
    },
  },
  messenger: {
    steps: [
      {
        key: "setup.messenger.app",
        fallback:
          "Add the Messenger product to the same Meta app and connect the Facebook Page you administer.",
      },
      {
        key: "setup.messenger.permissions",
        fallback: "Request these permissions for the Page token.",
        code: "pages_messaging, pages_manage_metadata",
      },
      {
        key: "setup.messenger.webhook",
        fallback:
          "Under Webhooks, register the callback URL shown on this page with your META_WEBHOOK_VERIFY_TOKEN and subscribe these fields.",
        code: "page → messages, messaging_postbacks, message_deliveries, message_reads",
      },
      {
        key: "setup.messenger.token",
        fallback:
          "Generate a Page access token and enter it in the form on this page together with the Page ID.",
      },
    ],
    caution: {
      key: "setup.messenger.caution",
      fallback:
        "Turn on Human Agent replies only after Meta grants that permission. It is for manual support, never for automated or promotional messages.",
    },
  },
  instagram: {
    steps: [
      {
        key: "setup.instagram.professional",
        fallback:
          "Switch the Instagram account to a professional account (Business or Creator).",
      },
      {
        key: "setup.instagram.page",
        fallback:
          "Link it to a Facebook Page you administer — Instagram Direct is reached through that Page, so this is required.",
      },
      {
        key: "setup.instagram.allowAccess",
        fallback:
          "In the Instagram app, turn on Settings → Messages and story replies → Connected tools → Allow access to messages.",
      },
      {
        key: "setup.instagram.permissions",
        fallback:
          "Add the Instagram product to the same Meta app and request these permissions.",
        code: "instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_messaging",
      },
      {
        key: "setup.instagram.webhook",
        fallback:
          "Under Webhooks, register the callback URL shown on this page with your META_WEBHOOK_VERIFY_TOKEN and subscribe these fields.",
        code: "instagram → messages, messaging_seen",
      },
      {
        key: "setup.instagram.connect",
        fallback:
          "Use Continue with Facebook, or fill in the Instagram account ID and the linked Page's access token in the form on this page.",
      },
    ],
    caution: {
      key: "setup.instagram.caution",
      fallback:
        "META_INSTAGRAM_CONFIGURATION_ID must be a Facebook Login for Business configuration. The ID under Instagram → API setup with Instagram login belongs to a different product, and its codes fail the exchange with a redirect_uri error.",
    },
  },
  telegram: {
    steps: [
      {
        key: "setup.telegram.botfather",
        fallback: "Open @BotFather in Telegram and send /newbot.",
      },
      {
        key: "setup.telegram.token",
        fallback: "Copy the token it replies with and enter it in the Bot token field.",
      },
      {
        key: "setup.telegram.connect",
        fallback:
          "Connect. Storify registers the webhook itself, so there is nothing to paste into a dashboard.",
      },
      {
        key: "setup.telegram.share",
        fallback:
          "Share the bot's t.me link so customers can start a conversation.",
      },
    ],
    caution: {
      key: "setup.telegram.caution",
      fallback:
        "Telegram needs no app review and has no reply window — a bot may answer any chat that has started it, at any time.",
    },
  },
};

interface ChannelConnectionsPanelProps {
  canManage?: boolean;
  /**
   * Connections already read on the server.
   *
   * When present the panel paints them on the first frame and skips its own
   * fetch — the admin page resolves them in an RSC and streams this in, so
   * there is no shell-then-spinner-then-content waterfall behind hydration.
   * The vendor settings form renders from a client component and cannot supply
   * them, so it omits both props and the panel fetches for itself.
   */
  initialConnections?: ChannelConnectionDTO[];
  initialWebhookUrl?: string;
}

export function ChannelConnectionsPanel({
  canManage = false,
  initialConnections,
  initialWebhookUrl,
}: ChannelConnectionsPanelProps) {
  const t = useTranslations("chat");
  // `t()` runs the ICU formatter, which throws when a placeholder in the
  // message has no value — so interpolation values must be handed to `t()`
  // itself. The fallback string never reaches the formatter, so it gets the
  // same substitution by hand.
  const tr = useFallbackTranslator(t);

  const [connections, setConnections] = useState<ChannelConnectionDTO[]>(
    initialConnections ?? [],
  );
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl ?? "");
  const [loading, setLoading] = useState(initialConnections === undefined);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ChannelTabValue>("whatsapp");
  const [whatsapp, setWhatsapp] = useState({
    businessAccountId: "",
    phoneNumberId: "",
    publicPhoneNumberE164: "",
    accessToken: "",
  });
  const [messenger, setMessenger] = useState({
    pageId: "",
    publicPageUsername: "",
    accessToken: "",
    messengerHumanAgentEnabled: false,
  });
  const [telegram, setTelegram] = useState({
    botToken: "",
    publicTelegramUsername: "",
  });
  const [instagram, setInstagram] = useState({
    instagramUserId: "",
    publicInstagramUsername: "",
    accessToken: "",
    messengerHumanAgentEnabled: false,
  });

  const load = useCallback(() => {
    const request = async () => {
      const response = await fetch("/api/chat/channels");
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("channelConnections.loadFailed", "Unable to load channel connections"),
        );
      }
      return payload.data as {
        connections?: ChannelConnectionDTO[];
        webhookUrl?: string;
      };
    };
    return request()
      .then((data) => {
        setConnections(data.connections || []);
        setWebhookUrl(data.webhookUrl || "");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : tr("channelConnections.loadFailed", "Unable to load channel connections"),
        );
      })
      .finally(() => setLoading(false));
  }, [tr]);
  // Reloads after connecting or disconnecting show the spinner; the first
  // load sets it during render below.
  const reload = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useEffect(() => {
    // Nothing to fetch when the server already resolved it, or when the viewer
    // cannot manage channels and the panel only renders the refusal.
    if (!canManage || initialConnections !== undefined) return;
    void load();
  }, [canManage, initialConnections, load]);
  useApplyOnChange([canManage, initialConnections], () => {
    if (canManage && initialConnections === undefined) setLoading(true);
  });

  const connect = async (provider: MessageProvider) => {
    setSaving(true);
    try {
      const data =
        provider === "whatsapp"
          ? whatsapp
          : provider === "instagram"
            ? instagram
            : provider === "telegram"
              ? telegram
              : messenger;
      const response = await fetch("/api/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...data }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("channelConnections.connectFailed", "Unable to connect channel"));
      }
      setWhatsapp((current) => ({ ...current, accessToken: "" }));
      setMessenger((current) => ({ ...current, accessToken: "" }));
      setInstagram((current) => ({ ...current, accessToken: "" }));
      setTelegram((current) => ({ ...current, botToken: "" }));
      toast.success(
        tr("channelConnections.connectedProvider", "{provider} connected", {
          provider: channelLabel(provider),
        }),
      );
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tr("channelConnections.connectFailed", "Unable to connect channel"),
      );
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (connectionId: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/channels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("channelConnections.disconnectFailed", "Unable to disconnect channel"),
        );
      }
      toast.success(tr("channelConnections.disconnected", "Channel disconnected"));
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("channelConnections.disconnectFailed", "Unable to disconnect channel"),
      );
    } finally {
      setSaving(false);
    }
  };

  const verify = async (connectionId: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("channelConnections.verifyFailed", "Unable to verify channel"),
        );
      }
      toast.success(tr("channelConnections.verified", "Channel connection verified"));
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("channelConnections.verifyFailed", "Unable to verify channel"),
      );
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const toggleHumanAgent = async (connectionId: string, enabled: boolean) => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          messengerHumanAgentEnabled: enabled,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("channelConnections.humanAgentFailed", "Unable to update Human Agent"),
        );
      }
      toast.success(
        enabled
          ? tr("channelConnections.humanAgentEnabled", "Human Agent replies enabled")
          : tr("channelConnections.humanAgentDisabled", "Human Agent replies disabled"),
      );
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("channelConnections.humanAgentFailed", "Unable to update Human Agent"),
      );
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const syncTemplates = async (connectionId: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/templates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr(
              "channelConnections.syncTemplatesFailed",
              "Unable to synchronize WhatsApp templates",
            ),
        );
      }
      toast.success(
        tr(
          "channelConnections.syncTemplatesDone",
          "{count} approved WhatsApp templates synchronized",
        ).replace("{count}", String(payload.data.approved)),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr(
              "channelConnections.syncTemplatesFailed",
              "Unable to synchronize WhatsApp templates",
            ),
      );
    } finally {
      setSaving(false);
    }
  };

  const connected = (provider: ChannelConnectionDTO["provider"]) =>
    connections.find(
      (connection) =>
        connection.provider === provider && connection.status === "active",
    );

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tr("channelConnections.title", "Meta API connections")}</CardTitle>
          <CardDescription>
            {tr(
              "channelConnections.noPermission",
              "You do not have permission to manage provider connections.",
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // The skeleton keeps the real header and tab labels — only the parts that
  // genuinely depend on the fetch are greyed out. A centred spinner replaced the
  // whole card, so the title, the channel list and the setup guide all waited on
  // a request none of them needed.
  if (loading) return <ChannelConnectionsPanelSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5" />
          {tr("channelConnections.title", "Meta API connections")}
        </CardTitle>
        <CardDescription>
          {tr(
            "channelConnections.description",
            "Connect a WhatsApp Business phone number, Facebook Page, Instagram professional account, or Telegram bot to receive and reply inside the omnichannel inbox. Access tokens are encrypted and are never returned by the API.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ChannelTabValue)}
          className="gap-5"
        >
          {/*
            A grid rather than the default inline pill row: four equal cards that
            fold to two columns on a phone instead of overflowing, and each one
            carries its own connection state. Which channels are live used to be
            discoverable only by clicking through all four tabs.
          */}
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 sm:grid-cols-4">
            {CHANNEL_TABS.map((tab) => {
              const connection = connections.find(
                (item) => item.provider === tab.value,
              );
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={`h-auto flex-col items-start gap-2 rounded-md border border-border bg-card p-3 shadow-none transition-colors hover:bg-muted/60 data-[state=active]:shadow-sm ${tab.accent}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <Icon className={`size-5 ${tab.brand}`} />
                    <ChannelStatusDot status={connection?.status} />
                  </span>
                  <span className="text-sm font-medium">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="whatsapp" className="space-y-4">
            {connected("whatsapp") ? (
              <>
                <ConnectedChannel
                  connection={connected("whatsapp")!}
                  disabled={!canManage || saving}
                  onDisconnect={disconnect}
                  onVerify={verify}
                  onSyncTemplates={syncTemplates}
                />
                <WhatsAppTemplateAuthoring
                  connectionId={connected("whatsapp")!._id}
                  disabled={!canManage || saving}
                />
              </>
            ) : (
              <>
                {/* Carries its own "or connect manually" rule; both vanish
                    together when Embedded Signup is not configured. */}
                <WhatsAppEmbeddedSignupButton
                  disabled={!canManage || saving}
                  onConnected={load}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-business-account-id">
                    {tr("channelConnections.wabaId", "WhatsApp Business Account ID")}
                  </Label>
                  <Input
                    id="whatsapp-business-account-id"
                    value={whatsapp.businessAccountId}
                    onChange={(event) =>
                      setWhatsapp((current) => ({
                        ...current,
                        businessAccountId: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("channelConnections.accessTokenHint", "Required to synchronize approved message templates.")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-phone-number-id">
                    {tr("channelConnections.phoneNumberId", "Phone number ID")}
                  </Label>
                  <Input
                    id="whatsapp-phone-number-id"
                    value={whatsapp.phoneNumberId}
                    onChange={(event) =>
                      setWhatsapp((current) => ({
                        ...current,
                        phoneNumberId: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-public-number">
                    {tr("channelConnections.publicWhatsApp", "Public WhatsApp number")}
                  </Label>
                  <Input
                    id="whatsapp-public-number"
                    value={whatsapp.publicPhoneNumberE164}
                    placeholder="+8801700000000"
                    onChange={(event) =>
                      setWhatsapp((current) => ({
                        ...current,
                        publicPhoneNumberE164: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("channelConnections.publicWhatsAppHint", "Optional override for the storefront click-to-chat link.")}
                  </p>
                </div>
                <TokenInput
                  id="whatsapp-access-token"
                  value={whatsapp.accessToken}
                  onChange={(accessToken) =>
                    setWhatsapp((current) => ({ ...current, accessToken }))
                  }
                  disabled={!canManage}
                />
                </div>
                <Button
                  disabled={
                    !canManage ||
                    saving ||
                    !whatsapp.businessAccountId.trim() ||
                    !whatsapp.phoneNumberId.trim() ||
                    !whatsapp.accessToken.trim()
                  }
                  onClick={() => void connect("whatsapp")}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Plug />}
                  {tr("channelConnections.connectProvider", "Connect WhatsApp", { provider: "WhatsApp" })}
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="messenger" className="space-y-4">
            {connected("messenger") ? (
              <ConnectedChannel
                connection={connected("messenger")!}
                disabled={!canManage || saving}
                onDisconnect={disconnect}
                onVerify={verify}
                onToggleHumanAgent={toggleHumanAgent}
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="messenger-page-id">
                    {tr("channelConnections.pageId", "Facebook Page ID")}
                  </Label>
                  <Input
                    id="messenger-page-id"
                    value={messenger.pageId}
                    onChange={(event) =>
                      setMessenger((current) => ({
                        ...current,
                        pageId: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="messenger-public-username">
                    {tr("channelConnections.publicPageUsername", "Public Facebook Page username")}
                  </Label>
                  <Input
                    id="messenger-public-username"
                    value={messenger.publicPageUsername}
                    placeholder="your.page"
                    onChange={(event) =>
                      setMessenger((current) => ({
                        ...current,
                        publicPageUsername: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("channelConnections.publicPageHint", "Optional override for the storefront m.me link.")}
                  </p>
                </div>
                <TokenInput
                  id="messenger-access-token"
                  className="sm:col-span-2"
                  value={messenger.accessToken}
                  onChange={(accessToken) =>
                    setMessenger((current) => ({ ...current, accessToken }))
                  }
                  disabled={!canManage}
                />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label>{tr("channelConnections.humanAgent", "Human Agent replies")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr(
                        "channelConnections.humanAgentHint",
                        "Allow manual support replies for up to seven days. Enable only after Meta approves the Human Agent permission; this cannot be used for automated or promotional messages.",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={messenger.messengerHumanAgentEnabled}
                    onCheckedChange={(messengerHumanAgentEnabled) =>
                      setMessenger((current) => ({
                        ...current,
                        messengerHumanAgentEnabled,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <Button
                  disabled={
                    !canManage ||
                    saving ||
                    !messenger.pageId.trim() ||
                    !messenger.accessToken.trim()
                  }
                  onClick={() => void connect("messenger")}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Plug />}
                  {tr("channelConnections.connectProvider", "Connect Messenger", { provider: "Messenger" })}
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="instagram" className="space-y-4">
            {connected("instagram") ? (
              <ConnectedChannel
                connection={connected("instagram")!}
                disabled={!canManage || saving}
                onDisconnect={disconnect}
                onVerify={verify}
                onToggleHumanAgent={toggleHumanAgent}
              />
            ) : (
              <>
                <InstagramConnectButton
                  disabled={!canManage || saving}
                  onConnected={load}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="instagram-user-id">
                    {tr("channelConnections.instagramUserId", "Instagram professional account ID")}
                  </Label>
                  <Input
                    id="instagram-user-id"
                    value={instagram.instagramUserId}
                    onChange={(event) =>
                      setInstagram((current) => ({
                        ...current,
                        instagramUserId: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="instagram-public-username">
                    {tr("channelConnections.publicInstagramUsername", "Public Instagram username")}
                  </Label>
                  <Input
                    id="instagram-public-username"
                    value={instagram.publicInstagramUsername}
                    placeholder="your.handle"
                    onChange={(event) =>
                      setInstagram((current) => ({
                        ...current,
                        publicInstagramUsername: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("channelConnections.publicInstagramHint", "Optional override for the storefront ig.me link.")}
                  </p>
                </div>
                <TokenInput
                  id="instagram-access-token"
                  className="sm:col-span-2"
                  value={instagram.accessToken}
                  onChange={(accessToken) =>
                    setInstagram((current) => ({ ...current, accessToken }))
                  }
                  disabled={!canManage}
                />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label>{tr("channelConnections.humanAgent", "Human Agent replies")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr(
                        "channelConnections.humanAgentHint",
                        "Allow manual support replies for up to seven days. Enable only after Meta approves the Human Agent permission; this cannot be used for automated or promotional messages.",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={instagram.messengerHumanAgentEnabled}
                    onCheckedChange={(messengerHumanAgentEnabled) =>
                      setInstagram((current) => ({
                        ...current,
                        messengerHumanAgentEnabled,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <Button
                  disabled={
                    !canManage ||
                    saving ||
                    !instagram.instagramUserId.trim() ||
                    !instagram.accessToken.trim()
                  }
                  onClick={() => void connect("instagram")}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Plug />}
                  {tr("channelConnections.connectProvider", "Connect Instagram", { provider: "Instagram" })}
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="telegram" className="space-y-4">
            {connected("telegram") ? (
              <ConnectedChannel
                connection={connected("telegram")!}
                disabled={!canManage || saving}
                onDisconnect={disconnect}
                onVerify={verify}
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="telegram-bot-token">
                    {tr("channelConnections.botToken", "Bot token from @BotFather")}
                  </Label>
                  <Input
                    id="telegram-bot-token"
                    type="password"
                    autoComplete="new-password"
                    value={telegram.botToken}
                    placeholder="123456789:AA..."
                    onChange={(event) =>
                      setTelegram((current) => ({
                        ...current,
                        botToken: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram-public-username">
                    {tr("channelConnections.publicTelegramUsername", "Public bot username")}
                  </Label>
                  <Input
                    id="telegram-public-username"
                    value={telegram.publicTelegramUsername}
                    placeholder="your_store_bot"
                    onChange={(event) =>
                      setTelegram((current) => ({
                        ...current,
                        publicTelegramUsername: event.target.value,
                      }))
                    }
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "channelConnections.publicTelegramHint",
                      "Optional override for the storefront t.me link; taken from the bot itself when blank.",
                    )}
                  </p>
                </div>
                </div>
                <Button
                  disabled={
                    !canManage || saving || !telegram.botToken.trim()
                  }
                  onClick={() => void connect("telegram")}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Plug />}
                  {tr("channelConnections.connectProvider", "Connect Telegram", { provider: "Telegram" })}
                </Button>
              </>
            )}
          </TabsContent>

          {/*
            Reference material, so it sits AFTER the form rather than pushing it
            below the fold. Both are outside the four TabsContent blocks because
            they are driven by `activeTab` alone — repeating them per tab would be
            four copies of the same markup.

            The callback URL is Meta-only: Telegram's webhook is registered by the
            server from the bot token, so showing that field there only invited
            people to paste it somewhere it does not belong.
          */}
          {webhookUrl && CHANNEL_TABS.find((tab) => tab.value === activeTab)?.webhook ? (
            <WebhookCallbackField url={webhookUrl} />
          ) : null}

          {/* Last, and directly under the callback URL its steps refer to. */}
          <ChannelSetupGuide
            channel={activeTab}
            connected={Boolean(connected(activeTab))}
          />
        </Tabs>
        <DeliveryFailuresPanel />
      </CardContent>
    </Card>
  );
}

/**
 * What the panel looks like before the connections have been read.
 *
 * Everything static is real markup, not a grey block: the card title, the
 * description and all four channel names render immediately and never move when
 * the data lands. Only the three things that genuinely need the fetch — the
 * per-channel status dots, the connect form, and the callback URL — are
 * placeholders. Exported so the admin page can use it as a Suspense fallback and
 * the vendor form as its own loading state, which is what keeps the two from
 * drifting into different shapes.
 */
export function ChannelConnectionsPanelSkeleton() {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5" />
          {tr("channelConnections.title", "Meta API connections")}
        </CardTitle>
        <CardDescription>
          {tr(
            "channelConnections.description",
            "Connect a WhatsApp Business phone number, Facebook Page, Instagram professional account, or Telegram bot to receive and reply inside the omnichannel inbox. Access tokens are encrypted and are never returned by the API.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNEL_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <div
                key={tab.value}
                className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <Icon className={`size-5 ${tab.brand}`} />
                  <Skeleton className="size-2 rounded-full" />
                </span>
                <span className="text-sm font-medium">{tab.label}</span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-28 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * The channel's account-setup checklist, collapsed once it is connected.
 *
 * Open by default while a channel is unconnected because that is precisely when
 * the steps are needed, and collapsed afterwards so a working panel is not
 * dominated by instructions for work already done.
 */
function ChannelSetupGuide({
  channel,
  connected,
}: {
  channel: ChannelTabValue;
  connected: boolean;
}) {
  const t = useTranslations("chat");
  // Values must reach `t()` itself — the ICU formatter throws on a placeholder
  // it was given no value for, so the two-argument `tr` used elsewhere in this
  // file cannot render the title.
  const tr = (
    key: string,
    fallback: string,
    values?: Record<string, string>,
  ) => {
    if (t.has(key)) return t(key as never, values as never);
    if (!values) return fallback;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      fallback,
    );
  };
  const setup = CHANNEL_SETUP[channel];
  const label = CHANNEL_TABS.find((tab) => tab.value === channel)?.label ?? "";
  const item = `setup-${channel}`;

  return (
    <Accordion
      type="single"
      collapsible
      // Keyed on the channel so switching tabs re-evaluates the default rather
      // than carrying the previous channel's open state across.
      key={`${channel}-${connected}`}
      defaultValue={connected ? undefined : item}
      className="rounded-md border bg-muted/20 px-4"
    >
      <AccordionItem value={item}>
        <AccordionTrigger className="hover:no-underline">
          <span className="flex items-center gap-2">
            <BookOpen className="size-4 text-muted-foreground" />
            {tr("channelConnections.setup.title", "{provider} setup guide", {
              provider: label,
            })}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          <ol className="space-y-3">
            {setup.steps.map((step, index) => (
              <li key={step.key} className="flex gap-3">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium tabular-nums ring-1 ring-border">
                  {index + 1}
                </span>
                <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <p>{tr(`channelConnections.${step.key}`, step.fallback)}</p>
                  {step.code ? (
                    <code className="block overflow-x-auto rounded-md bg-background px-2 py-1 font-mono text-[11px] whitespace-pre text-foreground ring-1 ring-border">
                      {step.code}
                    </code>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {setup.caution ? (
            <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {tr(
                `channelConnections.${setup.caution.key}`,
                setup.caution.fallback,
              )}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {tr(
              "channelConnections.setup.docs",
              "Full walkthrough: docs/OMNICHANNEL_MESSAGING.md",
            )}
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/**
 * The connection state of one channel, as a dot on its tab.
 *
 * Deliberately not a text badge: four of these sit in a row, and the point is
 * that the whole strip can be read at a glance. `error` earns a colour of its
 * own — a channel whose token died still looks "set up" everywhere else, and
 * that is exactly the state an operator needs to notice without hunting.
 */
function ChannelStatusDot({
  status,
}: {
  status?: ChannelConnectionDTO["status"];
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  if (status === "active") {
    return (
      <span
        className="size-2 rounded-full bg-emerald-500"
        title={tr("channelConnections.connected", "Connected")}
      />
    );
  }
  if (status === "error" || status === "pending") {
    return (
      <span
        className="size-2 rounded-full bg-amber-500"
        title={tr("channelConnections.needsAttention", "Needs attention")}
      />
    );
  }
  return (
    <span
      className="size-2 rounded-full border border-muted-foreground/30"
      title={tr("channelConnections.notConnected", "Not connected")}
    />
  );
}

/**
 * The shared Meta callback URL, with the two things that actually cost support
 * time: a copy button instead of a select-by-hand read-only input, and a warning
 * when the origin is not public HTTPS. Meta refuses to register an `http://` or
 * `localhost` callback outright, so a store owner developing locally would
 * otherwise copy a URL that can never work and blame the app.
 */
function WebhookCallbackField({ url }: { url: string }) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  const [copied, setCopied] = useState(false);
  const reachable = /^https:\/\//i.test(url) && !/^https:\/\/localhost\b/i.test(url);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tr("channelConnections.copyFailed", "Unable to copy the URL"));
    }
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <Label htmlFor="meta-webhook-callback-url">
        {tr("channelConnections.webhookUrl", "Meta webhook callback URL")}
      </Label>
      <div className="flex gap-2">
        <Input
          id="meta-webhook-callback-url"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void copy()}
          aria-label={tr("channelConnections.copyWebhookUrl", "Copy callback URL")}
        >
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tr(
          "channelConnections.webhookUrlHint",
          "Use this callback URL and the server's META_WEBHOOK_VERIFY_TOKEN in the Meta developer dashboard.",
        )}
      </p>
      {reachable ? null : (
        <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {tr(
            "channelConnections.webhookUrlNotPublic",
            "Meta only accepts a public HTTPS callback. Open this page on your live domain — or a tunnel — before registering it.",
          )}
        </p>
      )}
    </div>
  );
}

function TokenInput({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  className?: string;
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={id}>
        {tr("channelConnections.accessToken", "System user or Page access token")}
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function ConnectedChannel({
  connection,
  disabled,
  onDisconnect,
  onVerify,
  onSyncTemplates,
  onToggleHumanAgent,
}: {
  connection: ChannelConnectionDTO;
  disabled: boolean;
  onDisconnect: (connectionId: string) => Promise<void>;
  onVerify: (connectionId: string) => Promise<void>;
  onSyncTemplates?: (connectionId: string) => Promise<void>;
  onToggleHumanAgent?: (
    connectionId: string,
    enabled: boolean,
  ) => Promise<void>;
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  const identifier = accountIdentifier(connection);
  const contact = publicContact(connection);
  // Meta grants the extended manual-support window on both Messenger Platform
  // channels; the server reports the field only where it applies.
  const humanAgent = connection.messengerHumanAgentEnabled !== undefined;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{connection.displayName}</p>
            <Badge variant="outline" className="text-emerald-600">
              {tr("channelConnections.connected", "Connected")}
            </Badge>
          </div>
          {identifier ? (
            <p className="mt-1 text-xs text-muted-foreground">{identifier}</p>
          ) : null}
          {connection.businessAccountId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("channelConnections.businessAccount", "Business account")}:{" "}
              {connection.businessAccountId}
            </p>
          ) : null}
          {contact ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("channelConnections.publicContact", "Public contact")}:{" "}
              {contact}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void onVerify(connection._id)}
          >
            <RefreshCw className={disabled ? "animate-spin" : undefined} />
            {tr("channelConnections.verify", "Verify")}
          </Button>
          {connection.provider === "whatsapp" && onSyncTemplates ? (
            <Button
              variant="outline"
              disabled={disabled || !connection.businessAccountId}
              onClick={() => void onSyncTemplates(connection._id)}
            >
              {disabled ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {tr("channelConnections.syncTemplates", "Sync templates")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void onDisconnect(connection._id)}
          >
            <Unplug />
            {tr("channelConnections.disconnect", "Disconnect")}
          </Button>
        </div>
      </div>

      {humanAgent && onToggleHumanAgent ? (
        // Editable in place. It used to be settable only in the connect
        // payload, so changing it meant disconnecting and pasting the token in
        // again just to flip a boolean.
        <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label htmlFor={`human-agent-${connection._id}`}>
              {tr("channelConnections.humanAgent", "Human Agent replies")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {tr(
                "channelConnections.humanAgentHint",
                "Allow manual support replies for up to seven days. Enable only after Meta approves the Human Agent permission; this cannot be used for automated or promotional messages.",
              )}
            </p>
          </div>
          <Switch
            id={`human-agent-${connection._id}`}
            checked={Boolean(connection.messengerHumanAgentEnabled)}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              void onToggleHumanAgent(connection._id, enabled)
            }
          />
        </div>
      ) : null}
    </div>
  );
}
