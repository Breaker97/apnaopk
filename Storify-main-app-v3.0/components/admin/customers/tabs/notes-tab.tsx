"use client";

import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CustomerTabProps } from "../customer-detail-types";

export function NotesTab({ form, setField, readOnly }: CustomerTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
        <CardDescription>
          Private notes that are only visible to admins and staff
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          placeholder="Support context, buying behavior, escalation notes..."
          rows={10}
          maxLength={2000}
          disabled={readOnly}
        />
        <p className="mt-2 text-right text-xs text-muted-foreground">
          {form.notes.length}/2000
        </p>
      </CardContent>
    </Card>
  );
}
