"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TransferEventType } from "@/lib/inventory/transfer-rules";

export interface TransferHistoryEvent {
  _id?: string;
  type: TransferEventType;
  at: string;
  actorName?: string;
  note?: string;
  lines?: Array<{ accepted: number; rejected: number }>;
}

/**
 * Transfers from before history was recorded carry no events, only their
 * timestamps — those still make a (shorter, unattributed) timeline.
 */
function withLegacyEvents(record: {
  events?: TransferHistoryEvent[];
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
}): TransferHistoryEvent[] {
  if (record.events?.length) return record.events;
  const events: TransferHistoryEvent[] = [
    { type: "created", at: record.createdAt },
  ];
  if (record.completedAt) {
    events.push({ type: "completed", at: record.completedAt });
  }
  if (record.cancelledAt) {
    events.push({ type: "cancelled", at: record.cancelledAt });
  }
  return events;
}

export function TransferHistory({
  record,
}: {
  record: {
    events?: TransferHistoryEvent[];
    createdAt: string;
    completedAt?: string;
    cancelledAt?: string;
    fromLocationName: string;
    toLocationName: string;
  };
}) {
  const t = useTranslations("admin.transfers.history");
  const events = [...withLegacyEvents(record)].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5 border-l pl-5">
          {events.map((event, index) => {
            const accepted = (event.lines || []).reduce(
              (sum, line) => sum + (Number(line.accepted) || 0),
              0,
            );
            const rejected = (event.lines || []).reduce(
              (sum, line) => sum + (Number(line.rejected) || 0),
              0,
            );
            return (
              <li key={event._id || `${event.type}-${index}`} className="relative">
                <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <p className="text-sm font-medium">
                  {t(`events.${event.type}`, {
                    from: record.fromLocationName,
                    to: record.toLocationName,
                  })}
                </p>
                {event.type === "received" ? (
                  <p className="text-sm text-muted-foreground">
                    {t("receivedSummary", { accepted, rejected })}
                  </p>
                ) : null}
                {event.note ? (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {event.note}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(event.at).toLocaleString()}
                  {event.actorName ? ` · ${event.actorName}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
