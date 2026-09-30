"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
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

export function formatPreorderAccessDate(
  value: string | null | undefined,
  locale: string,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
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
  const t = useTranslations("admin.preorderAccess");
  const [busyVendorId, setBusyVendorId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{
    vendor: DecisionVendor;
    kind: RefusalKind;
  } | null>(null);
  const [values, setValues] = useState<InputDialogValues>({ note: "" });
  const [noteError, setNoteError] = useState<string | undefined>();

  const submit = useCallback(
    async (vendor: DecisionVendor, allow: boolean, note?: string) => {
      const name = vendor.storeName || t("vendorFallback");
      setBusyVendorId(vendor._id);
      try {
        await apiClient.put(`/api/admin/vendors/${vendor._id}/preorder`, {
          enabled: allow,
          ...(note?.trim() ? { note: note.trim() } : {}),
        });
        toast.success(
          allow
            ? t("approvedToast", { name })
            : refusal?.kind === "decline"
              ? t("declinedToast", { name })
              : t("revokedToast", { name }),
        );
        setRefusal(null);
        await onDecided();
      } catch (error) {
        toast.error(describeApiError(error, t("updateFailed")));
      } finally {
        setBusyVendorId(null);
      }
    },
    [onDecided, refusal, t],
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

  const name = refusal?.vendor.storeName || t("thisVendor");
  const dialog = (
    <InputDialog
      open={refusal !== null}
      onOpenChange={(open) => {
        if (!open && busyVendorId === null) setRefusal(null);
      }}
      title={
        refusal?.kind === "revoke"
          ? t("revokeTitle", { name })
          : t("declineTitle", { name })
      }
      description={
        refusal?.kind === "revoke"
          ? t("revokeDescription")
          : t("declineDescription")
      }
      fields={[
        {
          name: "note",
          label: t("reasonLabel"),
          placeholder: t("reasonPlaceholder"),
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
          setNoteError(t("reasonTooLong", { max: NOTE_MAX_LENGTH }));
          return;
        }
        void submit(refusal.vendor, false, submitted.note);
      }}
      submitText={
        refusal?.kind === "revoke" ? t("revokeSubmit") : t("declineSubmit")
      }
      submitVariant="destructive"
      loading={busyVendorId !== null}
      errors={{ note: noteError }}
    />
  );

  return { busyVendorId, approve, refuse, dialog };
}
