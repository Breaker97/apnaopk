"use client";

import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { VendorTabProps } from "../vendor-detail-types";

const NOTES_MAX = 5000;

export function NotesTab({ form, setField, readOnly }: VendorTabProps) {
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
          placeholder="Onboarding context, payout arrangements, escalation notes..."
          rows={10}
          maxLength={NOTES_MAX}
          disabled={readOnly}
        />
        <p className="mt-2 text-right text-xs text-muted-foreground">
          {form.notes.length}/{NOTES_MAX}
        </p>
      </CardContent>
    </Card>
  );
}
