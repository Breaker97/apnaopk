"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast-notification";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/products/import-limits";

interface CsvImportResult {
  created: number;
  updated: number;
  unchanged?: number;
  failed: number;
  errors?: { row: number; message: string }[];
}

interface UseCsvImportExportOptions {
  /** Route that serves the export on GET and takes the import on POST. */
  endpoint: string;
  /** Plural and lower case ("brands"): used in messages and the fallback file name. */
  noun: string;
  /** Runs once an import has created or changed something, to refresh the list. */
  onImported: () => void;
  /**
   * The export's toasts in the page's language. Without them they are built
   * in English from `noun`, as the catalog lists have them.
   */
  messages?: {
    exporting: string;
    exported: string;
    exportFailed: string;
  };
}

/**
 * The reason a route gave for refusing. A refusal the route returns itself
 * (`errorResponse`) puts it in `error`; one it throws (a validation or
 * permission error) puts it in `message`.
 */
function serverMessage(body: unknown): string | undefined {
  const { error, message } = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof error === "string" && error) return error;
  if (typeof message === "string" && message) return message;
  return undefined;
}

async function readServerError(response: Response, fallback: string) {
  return serverMessage(await response.json().catch(() => null)) ?? fallback;
}

function downloadName(response: Response, fallback: string) {
  const header = response.headers.get("Content-Disposition") ?? "";
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? fallback;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function describeRowError({ row, message }: { row: number; message: string }) {
  return row > 0 ? `Row ${row}: ${message}` : message;
}

/**
 * The Import / Export menu of a URL-driven catalog list: the export is a
 * download of the list's current view, the import uploads a CSV the user picks.
 * Both go to one server route and report through toasts, with a loading toast
 * while they run.
 *
 * The export's query is the page's own (search, tab, sort) minus its paging, so
 * the file holds every row of what is on screen, in the order it is shown.
 *
 * The caller renders the hidden file input with `fileInputId` and
 * `handleFileChange`, and points the menu items at `exportCsv` and
 * `openFilePicker`.
 */
export function useCsvImportExport({
  endpoint,
  noun,
  onImported,
  messages,
}: UseCsvImportExportOptions) {
  const searchParams = useSearchParams();
  // An id rather than a ref: a ref handed back through this hook's result
  // cannot be read during render, and the input is rendered by the caller.
  const fileInputId = useId();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const exportCsv = useCallback(async () => {
    const toastId = `${noun}-csv-export`;
    setIsExporting(true);
    toast.loading(messages?.exporting ?? `Preparing ${noun} export…`, { id: toastId });
    try {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      params.delete("limit");
      const query = params.toString();
      const response = await fetch(query ? `${endpoint}?${query}` : endpoint);
      if (!response.ok) {
        throw new Error(
          await readServerError(response, messages?.exportFailed ?? `The ${noun} could not be exported.`),
        );
      }
      saveBlob(
        await response.blob(),
        downloadName(response, `${noun}-${new Date().toISOString().slice(0, 10)}.csv`),
      );
      // A route that caps its file says how many rows it kept; the file alone
      // would pass for the whole list.
      const kept = response.headers.get("X-Export-Truncated");
      if (kept) {
        toast.warning(
          `Exported the first ${kept} ${noun} — more matched than one file holds. Narrow the filters to export the rest.`,
          { id: toastId, duration: 8000 },
        );
      } else {
        toast.success(messages?.exported ?? `Exported ${noun} to CSV`, { id: toastId });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : (messages?.exportFailed ?? `The ${noun} could not be exported.`),
        { id: toastId },
      );
    } finally {
      setIsExporting(false);
    }
  }, [endpoint, messages, noun, searchParams]);

  const openFilePicker = useCallback(() => {
    document.getElementById(fileInputId)?.click();
  }, [fileInputId]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Cleared so choosing the same file again (after fixing it) still fires.
      event.target.value = "";
      if (!file) return;

      if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
        toast.error("Choose a .csv file.");
        return;
      }
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        toast.error(
          "This file is larger than 5 MB. Split it into smaller files and import them one at a time.",
        );
        return;
      }

      const toastId = `${noun}-csv-import`;
      setIsImporting(true);
      toast.loading(`Importing ${noun}…`, { id: toastId });
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(endpoint, { method: "POST", body: formData });
        const body = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: CsvImportResult;
        } | null;
        if (!response.ok || !body?.success || !body.data) {
          throw new Error(serverMessage(body) ?? `The ${noun} could not be imported.`);
        }

        const result = body.data;
        const summary = [
          `${result.created} created`,
          `${result.updated} updated`,
          ...(result.unchanged ? [`${result.unchanged} unchanged`] : []),
        ].join(", ");

        if (result.failed === 0) {
          toast.success(`Imported ${noun}: ${summary}`, { id: toastId });
        } else {
          const [first] = result.errors ?? [];
          const more = (result.errors?.length ?? 0) - 1;
          const detail = first
            ? ` ${describeRowError(first)}${more > 0 ? ` (and ${more} more)` : ""}`
            : "";
          const message = `${result.failed} ${result.failed === 1 ? "row" : "rows"} failed. ${summary}.${detail}`;
          // Nothing went in at all is an error; some rows going in is a warning.
          if (result.created + result.updated + (result.unchanged ?? 0) === 0) {
            toast.error(`No ${noun} were imported. ${message}`, { id: toastId });
          } else {
            toast.warning(message, { id: toastId, duration: 8000 });
          }
        }

        if (result.created > 0 || result.updated > 0) onImported();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : `The ${noun} could not be imported.`,
          { id: toastId },
        );
      } finally {
        setIsImporting(false);
      }
    },
    [endpoint, noun, onImported],
  );

  return {
    fileInputId,
    exportCsv,
    openFilePicker,
    handleFileChange,
    isExporting,
    isImporting,
  };
}
