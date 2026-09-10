"use client";

import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Circle,
  CircleDot,
  KeyRound,
  Lightbulb,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  Sliders,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { IAISalesAgentSettings } from "@/models/settings.model";
import { CAPABILITY_META } from "@/components/admin/ai-sales-agent-admin/capability-meta";

interface SetupStep {
  title: string;
  description: string;
  done: boolean;
  tab: string;
  actionLabel: string;
  hint: string;
}

interface HowItWorksTabProps {
  settings: IAISalesAgentSettings;
  configured: boolean;
  setupSteps: readonly SetupStep[];
  setActiveTab: (tab: string) => void;
}

export function HowItWorksTab({
  settings,
  configured,
  setupSteps,
  setActiveTab,
}: HowItWorksTabProps) {
  const t = useTranslations("aiSalesAgentAdmin");
  const completedSteps = setupSteps.filter((step) => step.done).length;

  return (
    <TabsContent value="how-it-works" className="space-y-6">
      {/* Intro */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                {t("howItWorks.intro.title")}
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {t("howItWorks.intro.description")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={configured ? "default" : "destructive"}
              className="gap-1"
            >
              <CircleDot className="h-3 w-3" />
              {configured
                ? t("howItWorks.intro.openAIConfigured")
                : t("howItWorks.intro.openAIMissing")}
            </Badge>
            <Badge variant={settings.enabled ? "default" : "secondary"}>
              {settings.enabled
                ? t("howItWorks.intro.widgetLive")
                : t("howItWorks.intro.widgetOff")}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* What the agent can do */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" />
            {t("howItWorks.capabilities.title")}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("howItWorks.capabilities.description")}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(
            Object.keys(settings.capabilities) as Array<
              keyof IAISalesAgentSettings["capabilities"]
            >
          ).map((key) => {
            const meta = CAPABILITY_META[key];
            const on = settings.capabilities[key];
            return (
              <div
                key={key}
                className="flex items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      on
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
                <Badge variant={on ? "default" : "secondary"}>
                  {on
                    ? t("overview.capabilities.on")
                    : t("overview.capabilities.off")}
                </Badge>
              </div>
            );
          })}

          {/* Always-on feature, not a switchable capability */}
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BookOpen className="h-4 w-4" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("howItWorks.capabilities.multilingualTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("howItWorks.capabilities.multilingualDescription")}
                </p>
              </div>
            </div>
            <Badge variant="outline">
              {t("howItWorks.capabilities.alwaysOn")}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Setup checklist */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              {t("howItWorks.checklist.title")}
            </CardTitle>
            <Badge variant="outline" className="font-mono">
              {t("howItWorks.checklist.doneRatio", {
                completed: completedSteps,
                total: setupSteps.length,
              })}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("howItWorks.checklist.description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {setupSteps.map((step, index) => (
            <div
              key={step.title}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
                step.done ? "border-primary/30 bg-primary/[0.03]" : "",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-muted-foreground">
                      {index + 1}.
                    </span>
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground/80">
                    {step.hint}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant={step.done ? "ghost" : "outline"}
                className="shrink-0 gap-1.5 self-start sm:self-center"
                onClick={() => setActiveTab(step.tab)}
              >
                {step.actionLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* How a conversation flows */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            {t("howItWorks.flow.title")}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("howItWorks.flow.description")}
          </p>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {(
              ["open", "ask", "tools", "data", "reply", "logged"] as const
            ).map((stepKey, index) => (
              <li key={stepKey} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  {index < 5 ? (
                    <span className="mt-1 w-px flex-1 bg-border" />
                  ) : null}
                </div>
                <div className="space-y-1 pb-2">
                  <p className="text-sm font-medium">
                    {t(`howItWorks.flow.steps.${stepKey}.title`)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(`howItWorks.flow.steps.${stepKey}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Tips for best results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4" />
            {t("howItWorks.tips.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(
            [
              { icon: <BookOpen className="h-4 w-4" />, key: "faq" },
              { icon: <Bot className="h-4 w-4" />, key: "instructions" },
              { icon: <Sliders className="h-4 w-4" />, key: "model" },
              { icon: <Sparkles className="h-4 w-4" />, key: "recs" },
              { icon: <KeyRound className="h-4 w-4" />, key: "key" },
              {
                icon: <MessagesSquare className="h-4 w-4" />,
                key: "review",
              },
            ] as const
          ).map((tip) => (
            <div
              key={tip.key}
              className="flex items-start gap-3 rounded-lg border p-4"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {tip.icon}
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t(`howItWorks.tips.items.${tip.key}.title`)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`howItWorks.tips.items.${tip.key}.body`)}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Quick start CTA */}
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("howItWorks.cta.prompt")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => setActiveTab("configuration")}
            >
              <Sliders className="h-4 w-4" />
              {t("howItWorks.cta.configure")}
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => setActiveTab("test-chat")}
            >
              <MessageCircle className="h-4 w-4" />
              {t("howItWorks.cta.tryChat")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
