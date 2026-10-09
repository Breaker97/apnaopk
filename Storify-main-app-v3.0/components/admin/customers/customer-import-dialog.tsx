"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Columns3, Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChunkedImportDialog,
  type ChunkedImportEntity,
  type ImportFinished,
  type ImportMessage,
} from "@/components/admin/csv-import/chunked-import-dialog";
import { SetupGuide, SetupGuideSection } from "@/components/admin/setup-guide";
import {
  SettingList,
  SettingRow,
  SettingSwitchItem,
} from "@/components/admin/settings/fields/setting-row";
import { useAppSettings } from "@/providers/app-settings-provider";
import { csvLine } from "@/lib/catalog/csv";
import { soleAllowedCountry } from "@/lib/intl/country-availability";
import {
  checkCustomerHeaders,
  CUSTOMER_IMPORT_CHUNK_ROWS,
  CUSTOMER_IMPORT_MAX_FILE_BYTES,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_TEMPLATE_COLUMNS,
  customerImportSampleRows,
  customerRowKey,
  defaultImportTag,
  MAX_TAG_LENGTH,
  normalizeImportTag,
  readCustomerCells,
} from "@/lib/customers/customer-import-format";

/**
 * Admin → Customers → Import: a CSV of customers — the store's own template,
 * or a Shopify or WooCommerce customer export as it is — previewed, then
 * imported a few hundred rows at a time (`ChunkedImportDialog`).
 */

interface CustomerImportOptions {
  updateExisting: boolean;
  tag: string;
  sendInvites: boolean;
}

interface CustomerImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the person may update customers the file already matches: the
   * Edit customers permission, and access to every customer.
   */
  canUpdate: boolean;
  onImported: () => void;
}

const ENDPOINT = "/api/admin/customers/import-export";

function saveCsv(rows: string[][], filename: string) {
  const blob = new Blob([`﻿${rows.map((row) => csvLine(row)).join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CustomerImportDialog({
  open,
  onOpenChange,
  canUpdate,
  onImported,
}: CustomerImportDialogProps) {
  const t = useTranslations("admin.customerImport");
  const tagInputId = useId();
  const { countryAvailability } = useAppSettings();
  const [options, setOptions] = useState<CustomerImportOptions>(() => ({
    updateExisting: false,
    tag: defaultImportTag(),
    sendInvites: false,
  }));
  const tagValid = normalizeImportTag(options.tag) !== null;

  // A number written the national way can only be read with a country; the
  // store's one country, when it sells to one, is the browser's best guess.
  // The route reads every number again with the store's own setting.
  const defaultCountry = soleAllowedCountry(countryAvailability)?.value;

  const describe = useCallback(
    (message: ImportMessage) => {
      const params = { ...(message.params ?? {}) };
      // The record's state, in words: only refusals are ever reported kept.
      if (typeof params.state === "string" && t.has(`consentStates.${params.state}`)) {
        params.state = t(`consentStates.${params.state}`);
      }
      const key = `messages.${message.code}`;
      return t.has(key) ? t(key, params) : t("messages.write_failed");
    },
    [t],
  );

  const entity = useMemo<ChunkedImportEntity>(
    () => ({
      endpoint: ENDPOINT,
      chunkSize: CUSTOMER_IMPORT_CHUNK_ROWS,
      maxFileBytes: CUSTOMER_IMPORT_MAX_FILE_BYTES,
      maxRows: CUSTOMER_IMPORT_MAX_ROWS,
      checkHeaders: (headers) => {
        const checked = checkCustomerHeaders(headers);
        if (!checked.ok) return checked;
        return {
          ok: true,
          warnings: checked.warnings,
          rowKey: (cells) => customerRowKey(readCustomerCells(checked.map, cells), defaultCountry),
        };
      },
      describe,
    }),
    [defaultCountry, describe],
  );

  const guide = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("sourceHint")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => saveCsv(customerImportSampleRows(), "customer-import-template.csv")}
        >
          <Download className="h-4 w-4" />
          {t("downloadTemplate")}
        </Button>
      </div>
      <SetupGuide>
        <SetupGuideSection value="columns" icon={Columns3} title={t("guide.columnsTitle")}>
          <dl className="divide-y rounded-md border bg-background text-xs">
            {CUSTOMER_TEMPLATE_COLUMNS.map((column) => (
              <div
                key={column.field}
                className="grid gap-1 px-3 py-2 sm:grid-cols-[11rem_1fr] sm:gap-3"
              >
                <dt>
                  <code className="font-mono">{column.header}</code>
                </dt>
                <dd className="text-muted-foreground">{t(`guide.columns.${column.field}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{t("guide.otherPlatforms")}</p>
        </SetupGuideSection>
        <SetupGuideSection value="rules" icon={ListChecks} title={t("guide.rulesTitle")}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("guide.rules.match")}</li>
            <li>{t("guide.rules.duplicates")}</li>
            <li>{t("guide.rules.consent")}</li>
            <li>{t("guide.rules.address")}</li>
            <li>{t("guide.rules.rerun")}</li>
          </ul>
        </SetupGuideSection>
      </SetupGuide>
    </div>
  );

  const renderOptions = (disabled: boolean) => (
    <SettingList>
      <SettingSwitchItem
        title={t("options.updateExisting")}
        description={canUpdate ? t("options.updateExistingHint") : t("options.updateExistingDenied")}
        checked={options.updateExisting}
        disabled={disabled || !canUpdate}
        onCheckedChange={(updateExisting) => setOptions((current) => ({ ...current, updateExisting }))}
      />
      <SettingRow
        inputId={tagInputId}
        label={t("options.tag")}
        hint={tagValid ? t("options.tagHint") : t("options.tagInvalid", { max: MAX_TAG_LENGTH })}
      >
        <Input
          id={tagInputId}
          value={options.tag}
          maxLength={MAX_TAG_LENGTH}
          disabled={disabled}
          aria-invalid={!tagValid}
          onChange={(event) => setOptions((current) => ({ ...current, tag: event.target.value }))}
        />
      </SettingRow>
      <SettingSwitchItem
        title={t("options.sendInvites")}
        description={t("options.sendInvitesHint")}
        checked={options.sendInvites}
        disabled={disabled}
        onCheckedChange={(sendInvites) => setOptions((current) => ({ ...current, sendInvites }))}
      />
    </SettingList>
  );

  const renderFinished = (finished: ImportFinished | null, ran: CustomerImportOptions) => {
    const lines: string[] = [t("result.tagged", { tag: ran.tag.trim() })];
    if (finished?.invitesQueued) {
      lines.push(t("result.invitesQueued", { count: finished.invitesQueued }));
    } else if (ran.sendInvites && finished?.status === "stopped") {
      lines.push(t("result.invitesNotSent", { tag: ran.tag.trim() }));
    }
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  };

  return (
    <ChunkedImportDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // A new import starts with today's tag and the safe defaults again.
        if (!next) setOptions({ updateExisting: false, tag: defaultImportTag(), sendInvites: false });
      }}
      entity={entity}
      title={t("title")}
      description={t("description")}
      options={{ ...options, tag: options.tag.trim(), updateExisting: canUpdate && options.updateExisting }}
      optionsReady={tagValid}
      renderOptions={renderOptions}
      guide={guide}
      renderFinished={renderFinished}
      onImported={onImported}
    />
  );
}
