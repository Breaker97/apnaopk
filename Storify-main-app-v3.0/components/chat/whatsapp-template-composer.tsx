"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { createRequestAbort } from "@/lib/request-abort";
import type {
  ConversationDTO,
  ConversationMessageDTO,
  WhatsAppTemplateDTO,
} from "@/lib/conversations/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface WhatsAppTemplateComposerProps {
  conversationId: string;
  required?: boolean;
  onSent: (result: {
    conversation: ConversationDTO;
    message: ConversationMessageDTO;
  }) => void;
}

export function WhatsAppTemplateComposer({
  conversationId,
  required = false,
  onSent,
}: WhatsAppTemplateComposerProps) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  const [open, setOpen] = useState(required);
  const [templates, setTemplates] = useState<WhatsAppTemplateDTO[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const selected = useMemo(
    () => templates.find((template) => template._id === selectedId),
    [selectedId, templates],
  );

  useApplyOnChange([conversationId, required], () => {
    setOpen(required);
  });

  useEffect(() => {
    if (!open) return;
    const request = createRequestAbort("Template list request");
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/templates`,
          { signal: request.signal },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(
            payload?.message ||
              tr("templateComposer.loadFailed", "Unable to load templates"),
          );
        }
        const next = (payload.data.templates || []) as WhatsAppTemplateDTO[];
        setTemplates(next);
        setSelectedId((current) =>
          next.some((template) => template._id === current)
            ? current
            : next[0]?._id || "",
        );
        setValues({});
      } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") {
          toast.error(
            error instanceof Error
              ? error.message
              : tr(
                  "templateComposer.loadWhatsAppFailed",
                  "Unable to load WhatsApp templates",
                ),
          );
        }
      } finally {
        setLoading(false);
      }
    };
    void load().finally(request.settle);
    return request.cancel;
  }, [conversationId, open, tr]);

  const send = async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/templates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: selected._id,
            values,
            clientMessageId: crypto.randomUUID(),
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("templateComposer.sendFailed", "Unable to send template"),
        );
      }
      onSent(payload.data);
      setValues({});
      if (!required) setOpen(false);
      toast.success(tr("templateQueued", "WhatsApp template queued"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr(
              "templateComposer.sendWhatsAppFailed",
              "Unable to send WhatsApp template",
            ),
      );
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <FileText />
        {tr("useTemplate", "Use WhatsApp template")}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {tr("templateMessage", "WhatsApp template message")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr(
              "templateDescription",
              "Approved templates can be sent even after the reply window closes.",
            )}
          </p>
        </div>
        {!required ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-label={tr("closeComposer", "Close template composer")}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="grid min-h-24 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`whatsapp-template-${conversationId}`}>
              {tr("approvedTemplate", "Approved template")}
            </Label>
            <select
              id={`whatsapp-template-${conversationId}`}
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setValues({});
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {templates.map((template) => (
                <option key={template._id} value={template._id}>
                  {template.name} · {template.language}
                </option>
              ))}
            </select>
          </div>

          {selected ? (
            <>
              <div className="space-y-2 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selected.category}</Badge>
                  <Badge variant="outline">{selected.language}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm">
                  {selected.body || `[${selected.name}]`}
                </p>
              </div>
              {selected.variables.map((variable) => (
                <div key={variable.key} className="space-y-2">
                  <Label htmlFor={`${conversationId}-${variable.key}`}>
                    {variable.label}
                  </Label>
                  <Input
                    id={`${conversationId}-${variable.key}`}
                    type={variable.type === "text" ? "text" : "url"}
                    value={values[variable.key] || ""}
                    placeholder={variable.example}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [variable.key]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                disabled={
                  sending ||
                  selected.variables.some(
                    (variable) => !values[variable.key]?.trim(),
                  )
                }
                onClick={() => void send()}
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                {tr("sendTemplate", "Send approved template")}
              </Button>
            </>
          ) : null}
        </>
      ) : (
        <p className="rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">
          {tr(
            "noTemplates",
            "No approved templates are cached. Synchronize templates from the WhatsApp channel settings first.",
          )}
        </p>
      )}
    </div>
  );
}
