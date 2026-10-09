"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { createRequestAbort } from "@/lib/request-abort";
import type { ConversationDTO } from "@/lib/conversations/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface Assignee {
  userId: string;
  name: string;
  email?: string;
  role: "admin" | "vendor" | "staff";
}

interface AssignmentOptions {
  assignees: Assignee[];
  viewerUserId: string;
  canClaim: boolean;
  canManage: boolean;
}

interface ConversationAssignmentControlProps {
  conversation: ConversationDTO;
  onUpdated: (conversation: ConversationDTO) => void;
}

const UNASSIGNED = "__unassigned__";

export function ConversationAssignmentControl({
  conversation,
  onUpdated,
}: ConversationAssignmentControlProps) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  const [options, setOptions] = useState<AssignmentOptions>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useApplyOnChange([conversation._id], () => {
    setLoading(true);
  });
  useEffect(() => {
    const request = createRequestAbort("Assignment options request");
    fetch(`/api/chat/conversations/${conversation._id}/assignment`, {
      signal: request.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || tr("assignment.loadFailed", "Unable to load assignments"));
        }
        setOptions(payload.data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOptions(undefined);
      })
      .finally(() => {
        request.settle();
        if (!request.signal.aborted) setLoading(false);
      });
    return request.cancel;
  }, [conversation._id, tr]);

  const assign = async (userId: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/chat/conversations/${conversation._id}/assignment`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("assignment.updateFailed", "Unable to update assignment"));
      }
      onUpdated(payload.data.conversation);
      toast.success(
        userId
          ? tr("assignment.assigned", "Conversation assigned")
          : tr("assignment.removed", "Assignment removed"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tr("assignment.updateFailed", "Unable to update assignment"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  }

  if (!options) {
    return conversation.assignedTo ? (
      <Badge variant="outline">
        <UserRoundCheck className="size-3" />
        {conversation.assignedTo.name}
      </Badge>
    ) : null;
  }

  if (options.canManage) {
    return (
      <Select
        value={conversation.assignedTo?.userId || UNASSIGNED}
        disabled={saving}
        onValueChange={(value) =>
          void assign(value === UNASSIGNED ? null : value)
        }
      >
        <SelectTrigger className="h-8 w-[170px]" aria-label={tr("assignment.label", "Assigned agent")}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          <SelectValue placeholder={tr("assignment.unassigned", "Unassigned")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>
            {tr("assignment.unassigned", "Unassigned")}
          </SelectItem>
          {options.assignees.map((assignee) => (
            <SelectItem key={assignee.userId} value={assignee.userId}>
              {assignee.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (!conversation.assignedTo && options.canClaim) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => void assign(options.viewerUserId)}
      >
        {saving ? <Loader2 className="animate-spin" /> : <UserRoundCheck />}
        {tr("assignment.assignToMe", "Assign to me")}
      </Button>
    );
  }

  return conversation.assignedTo ? (
    <Badge variant="outline">
      <UserRoundCheck className="size-3" />
      {conversation.assignedTo.name}
    </Badge>
  ) : null;
}
