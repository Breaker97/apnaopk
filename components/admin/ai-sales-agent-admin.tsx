"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowUp,
  BarChart3,
  Bot,
  BookOpen,
  CircleDot,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCurrency } from "@/providers/currency-provider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import type { IAISalesAgentSettings } from "@/models/settings.model";
import { CAPABILITY_META } from "@/components/admin/ai-sales-agent-admin/capability-meta";
import { HowItWorksTab } from "@/components/admin/ai-sales-agent-admin/how-it-works-tab";
import { WidgetTab } from "@/components/admin/ai-sales-agent-admin/widget-tab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_AI_SALES_AGENT_SETTINGS } from "@/lib/ai-sales-agent/settings";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from "@/components/admin/underline-tabs";
import {
  AI_SALES_AGENT_MODELS,
  AI_SALES_AGENT_REASONING_EFFORTS,
  AI_SALES_AGENT_TONES,
} from "@/lib/ai-sales-agent/models";
import type { AISalesChatMessage } from "@/lib/ai-sales-agent/types";
import {
  AISalesAssistantAvatar,
  AISalesHeaderIcon,
  AISalesMessageBubble,
} from "@/components/ai-sales-agent/ai-sales-message";
import {
  DashboardStatsGrid,
  DashboardStatsGridSkeleton,
} from "@/components/admin/dashboard-stat-card";

type ConversationSummary = {
  id: string;
  sessionId: string;
  userId?: string;
  locale: string;
  status?: string;
  lastMessage: string;
  messageCount: number;
  actionCount: number;
  lastMessageAt?: string;
  updatedAt: string;
};

type TokenUsage = {
  month: string;
  requests: number;
  totalTokens: number;
  budget: number;
  exhausted: boolean;
};

type AdminPayload = {
  settings: IAISalesAgentSettings;
  configured: boolean;
  faviconUrl?: string;
  usage?: TokenUsage;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalActions: number;
    activeConversations: number;
    conversationsLast7Days: number;
    conversationsLast30Days: number;
  };
  conversations: ConversationSummary[];
};

type ConversationListItem = {
  id: string;
  sessionId: string;
  userId?: string;
  locale: string;
  status?: string;
  messageCount: number;
  actionCount: number;
  cartItemCount: number;
  lastUserMessage: string;
  lastAssistantMessage: string;
  lastMessageAt?: string;
  createdAt?: string;
};

type ConversationDetail = {
  id: string;
  sessionId: string;
  locale: string;
  status?: string;
  cartItemCount: number;
  lastMessageAt?: string;
  createdAt?: string;
  updatedAt?: string;
  customer?: { id: string; name?: string; email?: string };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    metadata?: unknown;
    createdAt?: string;
  }>;
  actions: Array<{
    id: string;
    type: string;
    name?: string;
    payload?: unknown;
    createdAt?: string;
  }>;
};

const MODELS = AI_SALES_AGENT_MODELS;

const emptyActionSet: Set<string> = new Set();

function normalizeSettings(value?: Partial<IAISalesAgentSettings>) {
  return {
    ...DEFAULT_AI_SALES_AGENT_SETTINGS,
    ...(value || {}),
    widget: {
      ...DEFAULT_AI_SALES_AGENT_SETTINGS.widget,
      ...(value?.widget || {}),
    },
    capabilities: {
      ...DEFAULT_AI_SALES_AGENT_SETTINGS.capabilities,
      ...(value?.capabilities || {}),
    },
    faq: Array.isArray(value?.faq) ? value!.faq : [],
  };
}

function formatRelativeTime(
  value: string | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return t("time.justNow");
  if (diff < 3600)
    return t("time.minutesAgo", { count: Math.floor(diff / 60) });
  if (diff < 86400)
    return t("time.hoursAgo", { count: Math.floor(diff / 3600) });
  if (diff < 86400 * 7)
    return t("time.daysAgo", { count: Math.floor(diff / 86400) });
  return date.toLocaleDateString();
}

function formatFullDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function AISalesAgentAdmin({ locale }: { locale: string }) {
  const { confirm } = useConfirmation();
  const t = useTranslations("aiSalesAgentAdmin");
  // The widget preview shows real product prices, so it formats them exactly as
  // the live storefront widget does.
  const { formatPrice: formatPreviewPrice } = useCurrency();
  const [settings, setSettings] = React.useState<IAISalesAgentSettings>(
    DEFAULT_AI_SALES_AGENT_SETTINGS,
  );
  const [configured, setConfigured] = React.useState(false);
  const [usage, setUsage] = React.useState<TokenUsage | null>(null);
  const [faviconUrl, setFaviconUrl] = React.useState("");
  const [recentConversations, setRecentConversations] = React.useState<
    ConversationSummary[]
  >([]);
  const [stats, setStats] = React.useState<AdminPayload["stats"]>({
    totalConversations: 0,
    totalMessages: 0,
    totalActions: 0,
    activeConversations: 0,
    conversationsLast7Days: 0,
    conversationsLast30Days: 0,
  });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("overview");

  // Test chat state
  const [testMessage, setTestMessage] = React.useState("");
  const [testConversationId, setTestConversationId] = React.useState<string>();
  const [testMessages, setTestMessages] = React.useState<AISalesChatMessage[]>(
    [],
  );
  const [testing, setTesting] = React.useState(false);

  // Conversation logs state
  const [conversationList, setConversationList] = React.useState<
    ConversationListItem[]
  >([]);
  const [conversationListLoading, setConversationListLoading] =
    React.useState(false);
  const [conversationSearch, setConversationSearch] = React.useState("");
  const [conversationLocale, setConversationLocale] =
    React.useState<string>("all");
  const [conversationStatus, setConversationStatus] =
    React.useState<string>("all");
  const [conversationPage, setConversationPage] = React.useState(1);
  const [conversationTotalPages, setConversationTotalPages] = React.useState(1);
  const [conversationTotal, setConversationTotal] = React.useState(0);
  const [activeConversation, setActiveConversation] =
    React.useState<ConversationDetail | null>(null);
  const [activeConversationLoading, setActiveConversationLoading] =
    React.useState(false);
  const [conversationOpen, setConversationOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai-sales-agent", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed");
      const data = json.data as AdminPayload;
      setSettings(normalizeSettings(data.settings));
      setConfigured(Boolean(data.configured));
      setUsage(data.usage ?? null);
      setFaviconUrl(data.faviconUrl || "");
      setRecentConversations(data.conversations || []);
      setStats(
        data.stats || {
          totalConversations: 0,
          totalMessages: 0,
          totalActions: 0,
          activeConversations: 0,
          conversationsLast7Days: 0,
          conversationsLast30Days: 0,
        },
      );
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const fetchConversations = React.useCallback(async () => {
    setConversationListLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(conversationPage));
      params.set("limit", "20");
      if (conversationSearch.trim())
        params.set("search", conversationSearch.trim());
      if (conversationLocale && conversationLocale !== "all")
        params.set("locale", conversationLocale);
      if (conversationStatus && conversationStatus !== "all")
        params.set("status", conversationStatus);

      const res = await fetch(
        `/api/admin/ai-sales-agent/conversations?${params.toString()}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed");
      const payload = json.data;
      setConversationList((payload?.data as ConversationListItem[]) || []);
      setConversationTotalPages(payload?.pagination?.totalPages || 1);
      setConversationTotal(payload?.pagination?.total || 0);
    } catch {
      toast.error(t("toast.loadConversationsFailed"));
    } finally {
      setConversationListLoading(false);
    }
  }, [
    conversationPage,
    conversationSearch,
    conversationLocale,
    conversationStatus,
    t,
  ]);

  React.useEffect(() => {
    if (activeTab !== "conversations") return;
    const timer = window.setTimeout(() => {
      void fetchConversations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, fetchConversations]);

  const openConversation = async (id: string) => {
    setConversationOpen(true);
    setActiveConversationLoading(true);
    setActiveConversation(null);
    try {
      const res = await fetch(`/api/admin/ai-sales-agent/conversations/${id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed");
      setActiveConversation(json.data as ConversationDetail);
    } catch {
      toast.error(t("toast.loadConversationFailed"));
      setConversationOpen(false);
    } finally {
      setActiveConversationLoading(false);
    }
  };

  const deleteConversation = async (id: string) => {
    const ok = await confirm({
      type: "danger",
      title: t("toast.deleteTitle"),
      description: t("toast.deleteDescription"),
      confirmText: t("toast.deleteConfirm"),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/ai-sales-agent/conversations/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed");
      toast.success(t("toast.deleteSuccess"));
      setConversationOpen(false);
      setActiveConversation(null);
      void fetchConversations();
      void load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.deleteFailed"),
      );
    }
  };

  const update = <K extends keyof IAISalesAgentSettings>(
    key: K,
    value: IAISalesAgentSettings[K],
  ) => setSettings((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-sales-agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to save settings");
      }
      setSettings(normalizeSettings(json.data.settings));
      setConfigured(Boolean(json.data.configured));
      toast.success(t("toast.saveSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const message = testMessage.trim();
    if (!message) return;
    setTesting(true);
    setTestMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: message },
    ]);
    setTestMessage("");
    try {
      const res = await fetch("/api/ai-sales-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: testConversationId,
          message,
          locale,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.message || t("toast.testFailed"));
      setTestConversationId(json.data.conversationId);
      setTestMessages((prev) => [...prev, json.data.message]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.testChatFailed"),
      );
    } finally {
      setTesting(false);
    }
  };

  const resetTestChat = () => {
    setTestMessages([]);
    setTestConversationId(undefined);
  };

  const localeOptions = React.useMemo(() => {
    const set = new Set<string>();
    recentConversations.forEach((c) => c.locale && set.add(c.locale));
    conversationList.forEach((c) => c.locale && set.add(c.locale));
    return Array.from(set).sort();
  }, [recentConversations, conversationList]);

  const setupSteps = React.useMemo(() => {
    const enabledCapabilities = Object.values(settings.capabilities).filter(
      Boolean,
    ).length;
    const faqCount = settings.faq?.length || 0;
    return [
      {
        title: t("howItWorks.checklist.steps.apiKey.title"),
        description: t("howItWorks.checklist.steps.apiKey.description"),
        done: configured,
        tab: "configuration",
        actionLabel: t("howItWorks.checklist.steps.apiKey.action"),
        hint: t("howItWorks.checklist.steps.apiKey.hint"),
      },
      {
        title: t("howItWorks.checklist.steps.model.title"),
        description: t("howItWorks.checklist.steps.model.description"),
        done: true,
        tab: "configuration",
        actionLabel: t("howItWorks.checklist.steps.model.action"),
        hint: t("howItWorks.checklist.steps.model.hint", {
          model: settings.model,
        }),
      },
      {
        title: t("howItWorks.checklist.steps.capabilities.title"),
        description: t("howItWorks.checklist.steps.capabilities.description"),
        done: enabledCapabilities > 0,
        tab: "configuration",
        actionLabel: t("howItWorks.checklist.steps.capabilities.action"),
        hint: t("howItWorks.checklist.steps.capabilities.hint", {
          enabled: enabledCapabilities,
        }),
      },
      {
        title: t("howItWorks.checklist.steps.identity.title"),
        description: t("howItWorks.checklist.steps.identity.description"),
        done: Boolean(settings.greeting?.trim()),
        tab: "behavior",
        actionLabel: t("howItWorks.checklist.steps.identity.action"),
        hint: settings.agentName
          ? t("howItWorks.checklist.steps.identity.hintWithName", {
              name: settings.agentName,
            })
          : t("howItWorks.checklist.steps.identity.hintNotSet"),
      },
      {
        title: t("howItWorks.checklist.steps.faq.title"),
        description: t("howItWorks.checklist.steps.faq.description"),
        done: faqCount > 0,
        tab: "behavior",
        actionLabel: t("howItWorks.checklist.steps.faq.action"),
        hint:
          faqCount > 0
            ? t("howItWorks.checklist.steps.faq.hintWithCount", {
                count: faqCount,
              })
            : t("howItWorks.checklist.steps.faq.hintEmpty"),
      },
      {
        title: t("howItWorks.checklist.steps.widget.title"),
        description: t("howItWorks.checklist.steps.widget.description"),
        done: true,
        tab: "widget",
        actionLabel: t("howItWorks.checklist.steps.widget.action"),
        hint: t("howItWorks.checklist.steps.widget.hint"),
      },
      {
        title: t("howItWorks.checklist.steps.enableWidget.title"),
        description: t("howItWorks.checklist.steps.enableWidget.description"),
        done: settings.enabled,
        tab: "configuration",
        actionLabel: t("howItWorks.checklist.steps.enableWidget.action"),
        hint: settings.enabled
          ? t("howItWorks.checklist.steps.enableWidget.hintLive")
          : t("howItWorks.checklist.steps.enableWidget.hintHidden"),
      },
      {
        title: t("howItWorks.checklist.steps.testChat.title"),
        description: t("howItWorks.checklist.steps.testChat.description"),
        done: stats.totalConversations > 0,
        tab: "test-chat",
        actionLabel: t("howItWorks.checklist.steps.testChat.action"),
        hint:
          stats.totalConversations > 0
            ? t("howItWorks.checklist.steps.testChat.hintWithCount", {
                count: stats.totalConversations,
              })
            : t("howItWorks.checklist.steps.testChat.hintEmpty"),
      },
    ] as const;
  }, [settings, configured, stats.totalConversations, t]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
        <DashboardStatsGridSkeleton items={6} />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("header.title")}
          </h1>
          <p className="text-muted-foreground">{t("header.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("header.refresh")}
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("header.saveChanges")}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <UnderlineTabsList>
          {(
            [
              {
                value: "overview",
                labelKey: "tabs.overview",
                icon: LayoutDashboard,
              },
              {
                value: "how-it-works",
                labelKey: "tabs.howItWorks",
                icon: HelpCircle,
              },
              {
                value: "configuration",
                labelKey: "tabs.configuration",
                icon: Sliders,
              },
              {
                value: "behavior",
                labelKey: "tabs.behavior",
                icon: Bot,
              },
              { value: "widget", labelKey: "tabs.widget", icon: Palette },
              {
                value: "conversations",
                labelKey: "tabs.conversations",
                icon: MessagesSquare,
                count: stats.totalConversations,
              },
              {
                value: "test-chat",
                labelKey: "tabs.testChat",
                icon: MessageCircle,
              },
            ] as const
          ).map((tab) => (
            <UnderlineTabsTrigger
              key={tab.value}
              value={tab.value}
              icon={tab.icon}
              count={"count" in tab ? tab.count : undefined}
            >
              {t(tab.labelKey)}
            </UnderlineTabsTrigger>
          ))}
        </UnderlineTabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-6">
          <DashboardStatsGrid
            stats={[
              {
                id: "conversations",
                label: t("overview.stats.totalConversations"),
                value: stats.totalConversations.toLocaleString(),
                subLabel: t("overview.stats.totalConversationsSub"),
                icon: <MessagesSquare />,
              },
              {
                id: "active",
                label: t("overview.stats.activeConversations"),
                value: stats.activeConversations.toLocaleString(),
                subLabel: t("overview.stats.activeConversationsSub"),
                icon: <CircleDot />,
              },
              {
                id: "messages",
                label: t("overview.stats.messagesExchanged"),
                value: stats.totalMessages.toLocaleString(),
                subLabel: t("overview.stats.messagesExchangedSub"),
                icon: <MessageCircle />,
              },
              {
                id: "avg-messages",
                label: t("overview.stats.avgMessages"),
                value:
                  stats.totalConversations > 0
                    ? (stats.totalMessages / stats.totalConversations).toFixed(
                        1,
                      )
                    : "0",
                subLabel: t("overview.stats.avgMessagesSub"),
                icon: <BarChart3 />,
              },
              {
                id: "actions",
                label: t("overview.stats.aiActions"),
                value: stats.totalActions.toLocaleString(),
                subLabel: t("overview.stats.aiActionsSub"),
                icon: <Zap />,
              },
              {
                id: "last-7-days",
                label: t("overview.stats.last7Days"),
                value: stats.conversationsLast7Days.toLocaleString(),
                subLabel: t("overview.stats.last30Days", {
                  count: stats.conversationsLast30Days,
                }),
                icon: <Activity />,
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessagesSquare className="h-4 w-4" />
                  {t("overview.recentConversations.title")}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("conversations")}
                  className="gap-1 text-xs"
                >
                  {t("overview.recentConversations.viewAll")}
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentConversations.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                    {t("overview.recentConversations.empty")}
                  </p>
                ) : (
                  recentConversations.slice(0, 5).map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => openConversation(conversation.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {conversation.lastMessage ||
                            t("overview.recentConversations.newConversation")}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {t("overview.recentConversations.messagesCount", {
                            count: conversation.messageCount,
                          })}{" "}
                          ·{" "}
                          {t("overview.recentConversations.actionsCount", {
                            count: conversation.actionCount,
                          })}{" "}
                          ·{" "}
                          {formatRelativeTime(
                            conversation.lastMessageAt ||
                              conversation.updatedAt,
                            t,
                          )}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {conversation.locale}
                      </Badge>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" />
                  {t("overview.capabilities.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(
                  Object.entries(settings.capabilities) as Array<
                    [keyof IAISalesAgentSettings["capabilities"], boolean]
                  >
                ).map(([key, value]) => {
                  const meta = CAPABILITY_META[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-md",
                            value
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {meta.icon}
                        </span>
                        <span className="text-sm font-medium">
                          {t(meta.labelKey)}
                        </span>
                      </div>
                      <Badge variant={value ? "default" : "secondary"}>
                        {value
                          ? t("overview.capabilities.on")
                          : t("overview.capabilities.off")}
                      </Badge>
                    </div>
                  );
                })}

                {/* Always-on feature, not a switchable capability */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium">
                      {t("overview.capabilities.multilingualTitle")}
                    </span>
                  </div>
                  <Badge variant="outline">
                    {t("overview.capabilities.alwaysOn")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* HOW IT WORKS */}
        <HowItWorksTab
          settings={settings}
          configured={configured}
          setupSteps={setupSteps}
          setActiveTab={setActiveTab}
        />

        {/* CONFIGURATION */}
        <TabsContent value="configuration" className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={configured ? "default" : "destructive"}
              className="gap-1"
            >
              <CircleDot className="h-3 w-3" />
              {configured
                ? t("configuration.openAIConfigured")
                : t("configuration.openAIMissing")}
            </Badge>
            <Badge variant={settings.enabled ? "default" : "secondary"}>
              {settings.enabled
                ? t("configuration.widgetEnabled")
                : t("configuration.widgetDisabled")}
            </Badge>
            <Badge variant="outline">{settings.model}</Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />
                {t("configuration.modelRuntime.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2">
                <div className="space-y-1">
                  <Label>{t("configuration.modelRuntime.enableWidget")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t("configuration.modelRuntime.enableWidgetDescription")}
                  </p>
                </div>
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(value) => update("enabled", value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("configuration.modelRuntime.model")}</Label>
                <Select
                  value={settings.model}
                  onValueChange={(value) =>
                    update("model", value as IAISalesAgentSettings["model"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("configuration.modelRuntime.modelDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("configuration.modelRuntime.reasoningEffort")}</Label>
                <Select
                  value={settings.reasoningEffort}
                  onValueChange={(value) =>
                    update(
                      "reasoningEffort",
                      value as IAISalesAgentSettings["reasoningEffort"],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_SALES_AGENT_REASONING_EFFORTS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("configuration.modelRuntime.reasoningEffortDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("configuration.modelRuntime.temperature")}</Label>
                <NumberInput
                  min={0}
                  max={1}
                  step={0.1}
                  value={settings.temperature}
                  whenEmpty="keep"
                  onValueChange={(next) => {
                    if (next !== undefined) update("temperature", next);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("configuration.modelRuntime.temperatureDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  {t("configuration.modelRuntime.maxRecommendations")}
                </Label>
                <NumberInput
                  min={1}
                  max={8}
                  step={1}
                  value={settings.maxRecommendations}
                  whenEmpty="keep"
                  normalize={Math.trunc}
                  onValueChange={(next) => {
                    if (next !== undefined) update("maxRecommendations", next);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "configuration.modelRuntime.maxRecommendationsDescription",
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("configuration.modelRuntime.monthlyTokenBudget")}</Label>
                <NumberInput
                  min={0}
                  step={10000}
                  value={settings.monthlyTokenBudget}
                  whenEmpty="keep"
                  normalize={Math.trunc}
                  onValueChange={(next) => {
                    if (next !== undefined) update("monthlyTokenBudget", next);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("configuration.modelRuntime.monthlyTokenBudgetDescription")}
                </p>
                {usage && (
                  <p
                    className={cn(
                      "text-xs",
                      usage.exhausted
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("configuration.modelRuntime.monthlyTokenUsage", {
                      month: usage.month,
                      tokens: usage.totalTokens.toLocaleString(),
                      requests: usage.requests.toLocaleString(),
                    })}
                    {usage.exhausted &&
                      ` ${t("configuration.modelRuntime.monthlyTokenBudgetReached")}`}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4" />
                {t("configuration.capabilities.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(
                Object.entries(settings.capabilities) as Array<
                  [keyof IAISalesAgentSettings["capabilities"], boolean]
                >
              ).map(([key, value]) => {
                const meta = CAPABILITY_META[key];
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex flex-1 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          value
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {meta.icon}
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {t(meta.labelKey)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t(meta.descriptionKey)}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={Boolean(value)}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({
                          ...prev,
                          capabilities: {
                            ...prev.capabilities,
                            [key]: checked,
                          },
                        }))
                      }
                    />
                  </label>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BEHAVIOR */}
        <TabsContent value="behavior" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                {t("behavior.identity.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("behavior.identity.agentName")}</Label>
                  <Input
                    value={settings.agentName}
                    onChange={(event) =>
                      update("agentName", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("behavior.identity.tone")}</Label>
                  <Select
                    value={settings.tone}
                    onValueChange={(value) =>
                      update("tone", value as IAISalesAgentSettings["tone"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_SALES_AGENT_TONES.map((tone) => (
                        <SelectItem key={tone} value={tone}>
                          {tone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("behavior.identity.greeting")}</Label>
                <Textarea
                  value={settings.greeting}
                  onChange={(event) => update("greeting", event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("behavior.identity.greetingDescription")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("behavior.identity.instructions")}</Label>
                <Textarea
                  rows={6}
                  value={settings.instructions || ""}
                  onChange={(event) =>
                    update("instructions", event.target.value)
                  }
                  placeholder={t("behavior.identity.instructionsPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("behavior.identity.instructionsDescription")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("behavior.identity.escalation")}</Label>
                <Textarea
                  value={settings.escalationMessage}
                  onChange={(event) =>
                    update("escalationMessage", event.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("behavior.identity.escalationDescription")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4" />
                  {t("behavior.faq.title")}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    update("faq", [
                      ...(settings.faq || []),
                      { question: "", answer: "", tags: [] },
                    ])
                  }
                  disabled={(settings.faq?.length || 0) >= 50}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("behavior.faq.addEntry")}
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("behavior.faq.description")}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(settings.faq || []).length === 0 ? (
                <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                  {t("behavior.faq.empty")}
                </p>
              ) : (
                (settings.faq || []).map((entry, index) => (
                  <div key={index} className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <Input
                          placeholder={t("behavior.faq.questionPlaceholder")}
                          value={entry.question}
                          maxLength={300}
                          onChange={(event) => {
                            const next = [...(settings.faq || [])];
                            next[index] = {
                              ...next[index],
                              question: event.target.value,
                            };
                            update("faq", next);
                          }}
                        />
                        <Textarea
                          placeholder={t("behavior.faq.answerPlaceholder")}
                          rows={3}
                          value={entry.answer}
                          maxLength={2000}
                          onChange={(event) => {
                            const next = [...(settings.faq || [])];
                            next[index] = {
                              ...next[index],
                              answer: event.target.value,
                            };
                            update("faq", next);
                          }}
                        />
                        <Input
                          placeholder={t("behavior.faq.tagsPlaceholder")}
                          value={(entry.tags || []).join(", ")}
                          onChange={(event) => {
                            const next = [...(settings.faq || [])];
                            next[index] = {
                              ...next[index],
                              tags: event.target.value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                            };
                            update("faq", next);
                          }}
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const next = (settings.faq || []).filter(
                            (_, i) => i !== index,
                          );
                          update("faq", next);
                        }}
                        aria-label={t("behavior.faq.removeAria")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* WIDGET */}
        <WidgetTab
          settings={settings}
          setSettings={setSettings}
          faviconUrl={faviconUrl}
        />

        {/* CONVERSATIONS */}
        <TabsContent value="conversations" className="space-y-4">
          <Card className="gap-3">
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessagesSquare className="h-4 w-4" />
                    {t("conversations.title")}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("conversations.totalCount", {
                      count: conversationTotal,
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConversationPage(1);
                    void fetchConversations();
                  }}
                  className="gap-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("conversations.refresh")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[2fr_1fr_1fr]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("conversations.searchPlaceholder")}
                    className="pl-9"
                    value={conversationSearch}
                    onChange={(event) => {
                      setConversationSearch(event.target.value);
                      setConversationPage(1);
                    }}
                  />
                </div>
                <Select
                  value={conversationLocale}
                  onValueChange={(value) => {
                    setConversationLocale(value);
                    setConversationPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("conversations.locale")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("conversations.allLocales")}
                    </SelectItem>
                    {localeOptions.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={conversationStatus}
                  onValueChange={(value) => {
                    setConversationStatus(value);
                    setConversationPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("conversations.status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("conversations.allStatuses")}
                    </SelectItem>
                    <SelectItem value="active">
                      {t("conversations.statusActive")}
                    </SelectItem>
                    <SelectItem value="closed">
                      {t("conversations.statusClosed")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border">
                {conversationListLoading ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : conversationList.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {t("conversations.empty")}
                  </div>
                ) : (
                  <div className="divide-y">
                    {conversationList.map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => openConversation(conversation.id)}
                        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/40"
                      >
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                          style={{
                            background: `linear-gradient(135deg, ${settings.widget.primaryColor}, ${settings.widget.accentColor})`,
                          }}
                        >
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {conversation.lastUserMessage ||
                                conversation.lastAssistantMessage ||
                                t("conversations.newConversation")}
                            </p>
                          </div>
                          {conversation.lastAssistantMessage &&
                            conversation.lastUserMessage && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {t("conversations.aiPrefix", {
                                  message: conversation.lastAssistantMessage,
                                })}
                              </p>
                            )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {t("conversations.messagesCount", {
                                count: conversation.messageCount,
                              })}
                            </span>
                            <span>·</span>
                            <span>
                              {t("conversations.actionsCount", {
                                count: conversation.actionCount,
                              })}
                            </span>
                            <span>·</span>
                            <span>
                              {formatRelativeTime(
                                conversation.lastMessageAt,
                                t,
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <Badge variant="secondary" className="capitalize">
                            {conversation.status || "active"}
                          </Badge>
                          <Badge variant="outline">{conversation.locale}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {conversationTotalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <p className="text-muted-foreground">
                    {t("conversations.pageOf", {
                      page: conversationPage,
                      total: conversationTotalPages,
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        conversationPage <= 1 || conversationListLoading
                      }
                      onClick={() =>
                        setConversationPage((p) => Math.max(1, p - 1))
                      }
                    >
                      {t("conversations.previous")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        conversationPage >= conversationTotalPages ||
                        conversationListLoading
                      }
                      onClick={() =>
                        setConversationPage((p) =>
                          Math.min(conversationTotalPages, p + 1),
                        )
                      }
                    >
                      {t("conversations.next")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TEST CHAT */}
        <TabsContent value="test-chat" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="h-4 w-4" />
                  {t("testChat.title")}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetTestChat}
                  className="gap-1.5 text-xs"
                  disabled={testMessages.length === 0 && !testConversationId}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("testChat.reset")}
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("testChat.description")}
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center rounded-xl bg-muted/40 p-4">
                <div
                  className="flex flex-col overflow-hidden rounded-[32px] border bg-background text-foreground shadow-sm"
                  style={{
                    width: `min(${settings.widget.width}px, 100%)`,
                    height: `${Math.max(settings.widget.height, 0)}px`,
                    maxHeight: "70vh",
                  }}
                >
                  <div className="relative px-4 pt-4">
                    <div
                      className="flex h-12 items-center justify-between rounded-full px-5 text-white"
                      style={{
                        background: `linear-gradient(135deg, ${settings.widget.primaryColor}, ${settings.widget.accentColor})`,
                      }}
                    >
                      <span className="text-sm font-semibold tracking-wide">
                        {settings.widget.headerTitle?.trim() ||
                          settings.agentName}
                      </span>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                        <Plus className="h-4 w-4 rotate-45" />
                      </span>
                    </div>
                    <div className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2">
                      <AISalesHeaderIcon
                        avatarUrl={settings.widget.avatarUrl}
                        faviconUrl={faviconUrl}
                        primaryColor={settings.widget.primaryColor}
                        accentColor={settings.widget.accentColor}
                        agentName={settings.agentName}
                      />
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-10">
                    <div className="flex gap-2">
                      <AISalesAssistantAvatar
                        primaryColor={settings.widget.primaryColor}
                      />
                      <div className="w-fit max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                        {settings.greeting}
                      </div>
                    </div>

                    {testMessages.map((message) => (
                      <AISalesMessageBubble
                        key={message.id}
                        message={message}
                        primaryColor={settings.widget.primaryColor}
                        formatPrice={formatPreviewPrice}
                        addedActions={emptyActionSet}
                        pendingActions={emptyActionSet}
                      />
                    ))}

                    {testing && (
                      <div className="flex items-center gap-2">
                        <AISalesAssistantAvatar
                          primaryColor={settings.widget.primaryColor}
                        />
                        <div className="flex items-center gap-1 rounded-3xl bg-muted px-4 py-3">
                          {[0, 150, 300].map((delay) => (
                            <span
                              key={delay}
                              className="h-1.5 w-1.5 animate-bounce rounded-full"
                              style={{
                                backgroundColor: settings.widget.primaryColor,
                                animationDelay: `${delay}ms`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-4 pb-4">
                    <div
                      className="flex items-center gap-2 rounded-full border-2 bg-card py-1.5 pl-4 pr-1.5 text-foreground"
                      style={{ borderColor: settings.widget.primaryColor }}
                    >
                      <input
                        value={testMessage}
                        onChange={(event) => setTestMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void sendTest();
                        }}
                        placeholder={t("testChat.typeMessage")}
                        className="h-9 flex-1 bg-transparent text-sm leading-none outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        type="button"
                        onClick={sendTest}
                        disabled={testing || !testMessage.trim()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
                        style={{
                          backgroundColor: settings.widget.primaryColor,
                        }}
                      >
                        {testing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {settings.widget.showFooterText &&
                      settings.widget.footerText && (
                        <p className="mt-2 text-center text-[11px] text-muted-foreground">
                          {settings.widget.footerText}
                        </p>
                      )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Conversation detail drawer */}
      <Sheet
        open={conversationOpen}
        onOpenChange={(open) => {
          setConversationOpen(open);
          if (!open) setActiveConversation(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="flex items-center gap-2">
              <MessagesSquare className="h-5 w-5" />
              {t("drawer.title")}
            </SheetTitle>
            <SheetDescription>
              {activeConversation
                ? t("drawer.session", {
                    id: activeConversation.sessionId,
                  })
                : t("drawer.loading")}
            </SheetDescription>
          </SheetHeader>

          {activeConversationLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : activeConversation ? (
            <div className="space-y-5 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.status")}
                  </p>
                  <p className="mt-1 text-sm font-medium capitalize">
                    {activeConversation.status || "active"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.locale")}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {activeConversation.locale}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.customer")}
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">
                    {activeConversation.customer
                      ? activeConversation.customer.name ||
                        activeConversation.customer.email ||
                        activeConversation.customer.id
                      : t("drawer.guest")}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.started")}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {formatFullDate(activeConversation.createdAt)}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">
                  {t("drawer.messagesTitle", {
                    count: activeConversation.messages.length,
                  })}
                </h3>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  {activeConversation.messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("drawer.noMessages")}
                    </p>
                  ) : (
                    activeConversation.messages.map((message) => {
                      const isUser = message.role === "user";
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "flex",
                            isUser ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                              isUser
                                ? "text-white"
                                : "bg-background text-foreground",
                            )}
                            style={
                              isUser
                                ? {
                                    backgroundColor:
                                      settings.widget.primaryColor,
                                  }
                                : undefined
                            }
                          >
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {message.content || (
                                <em className="text-muted-foreground">
                                  {t("drawer.emptyMessage")}
                                </em>
                              )}
                            </p>
                            <p
                              className={cn(
                                "mt-1 text-[10px]",
                                isUser
                                  ? "text-white/70"
                                  : "text-muted-foreground",
                              )}
                            >
                              {message.role} ·{" "}
                              {formatRelativeTime(message.createdAt, t)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {activeConversation.actions.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold">
                    {t("drawer.actionsTitle", {
                      count: activeConversation.actions.length,
                    })}
                  </h3>
                  <div className="space-y-2">
                    {activeConversation.actions.map((action) => (
                      <div
                        key={action.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="capitalize">
                            {action.type?.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(action.createdAt, t)}
                          </span>
                        </div>
                        {action.name && (
                          <p className="mt-2 font-mono text-[11px]">
                            {action.name}
                          </p>
                        )}
                        {action.payload != null && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-[10px]">
                            {JSON.stringify(action.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => deleteConversation(activeConversation.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("drawer.delete")}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
