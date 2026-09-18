"use client";

import { useCallback, useState } from "react";
import { toast } from "@/components/ui/toast-notification";
import {
  InputDialog,
  type InputDialogValues,
} from "@/components/ui/input-dialog";
import { apiClient, describeApiError } from "@/lib/api/client";

type DecisionVendor = { _id: string; storeName?: string };
type RefusalKind = "decline" | "revoke";

/** Same cap the route validates; checked here so the dialog can say so. */
const NOTE_MAX_LENGTH = 500;

export function formatPreorderAccessDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Approve, decline or withdraw a vendor's pre-order access — shared by the
 * queue in Marketplace settings and the Access tab of the vendor's own page.
 *
 * Refusing asks for a reason first. It is optional, but it is the only
 * explanation the vendor gets: it goes out with the notification and email
 * that tell them the answer.
 */
export function usePreorderAccessDecision(
  onDecided: () => void | Promise<void>,
) {
  const [busyVendorId, setBusyVendorId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{
    vendor: DecisionVendor;
    kind: RefusalKind;
  } | null>(null);
  const [values, setValues] = useState<InputDialogValues>({ note: "" });
  const [noteError, setNoteError] = useState<string | undefined>();

  const submit = useCallback(
    async (vendor: DecisionVendor, allow: boolean, note?: string) => {
      const name = vendor.storeName || "Vendor";
      setBusyVendorId(vendor._id);
      try {
        await apiClient.put(`/api/admin/vendors/${vendor._id}/preorder`, {
          enabled: allow,
          ...(note?.trim() ? { note: note.trim() } : {}),
        });
        toast.success(
          allow
            ? `${name} can now open pre-orders`
            : refusal?.kind === "decline"
              ? `${name}'s pre-order request was declined`
              : `${name} can no longer open new pre-orders`,
        );
        setRefusal(null);
        await onDecided();
      } catch (error) {
        toast.error(
          describeApiError(error, "Failed to update pre-order access"),
        );
      } finally {
        setBusyVendorId(null);
      }
    },
    [onDecided, refusal],
  );

  const approve = useCallback(
    (vendor: DecisionVendor) => void submit(vendor, true),
    [submit],
  );

  const refuse = useCallback((vendor: DecisionVendor, kind: RefusalKind) => {
    setValues({ note: "" });
    setNoteError(undefined);
    setRefusal({ vendor, kind });
  }, []);

  const name = refusal?.vendor.storeName || "this vendor";
  const dialog = (
    <InputDialog
      open={refusal !== null}
      onOpenChange={(open) => {
        if (!open && busyVendorId === null) setRefusal(null);
      }}
      title={
        refusal?.kind === "revoke"
          ? `Withdraw pre-order access from ${name}?`
          : `Decline ${name}'s pre-order request?`
      }
      description={
        refusal?.kind === "revoke"
          ? "They will not be able to open new pre-orders. Pre-orders already selling keep running — shoppers have paid deposits against them."
          : "They can send a new request later."
      }
      fields={[
        {
          name: "note",
          label: "Reason (sent to the vendor)",
          placeholder: "Optional",
          multiline: true,
          rows: 3,
        },
      ]}
      values={values}
      onValuesChange={(next) => {
        setValues(next);
        setNoteError(undefined);
      }}
      onSubmit={(submitted) => {
        if (!refusal) return;
        if ((submitted.note || "").trim().length > NOTE_MAX_LENGTH) {
          setNoteError(`Keep the reason under ${NOTE_MAX_LENGTH} characters.`);
          return;
        }
        void submit(refusal.vendor, false, submitted.note);
      }}
      submitText={refusal?.kind === "revoke" ? "Withdraw access" : "Decline"}
      submitVariant="destructive"
      loading={busyVendorId !== null}
      errors={{ note: noteError }}
    />
  );

  return { busyVendorId, approve, refuse, dialog };
}
