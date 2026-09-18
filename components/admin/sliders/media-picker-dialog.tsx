"use client";

import { useEffect, useState } from "react";
import { Film, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Pick a picture or a video the store already has, instead of uploading it
 * again. Reads the media library's own listing (/api/admin/media), a page
 * at a time, with the same search the library offers.
 */

export interface PickedMedia {
  url: string;
  name: string;
  size?: number;
  width?: number;
  height?: number;
}

interface MediaRow {
  key?: string;
  url?: string;
  name?: string;
  filename?: string;
  size?: number;
  width?: number;
  height?: number;
  kind?: string;
  contentType?: string;
  mimeType?: string;
}

export interface MediaPickerLabels {
  title: string;
  description: string;
  search: string;
  empty: string;
  loadMore: string;
  loadFailed: string;
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  kind,
  onPick,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "image" | "video";
  onPick: (media: PickedMedia) => void;
  labels: MediaPickerLabels;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = async (next?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "48", kind });
      if (next) params.set("cursor", next);
      if (query) params.set("q", query);
      const res = await fetch(`/api/admin/media?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || labels.loadFailed);
      const data = json.data as { files?: MediaRow[]; nextCursor?: string };
      setRows((current) => (next ? [...current, ...(data.files ?? [])] : (data.files ?? [])));
      setCursor(data.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // A fresh listing whenever the dialog opens or the search settles —
    // started off the effect's own tick, so no state is set inside it.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.search}
            className="h-9 pl-8"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {error ? <p className="py-6 text-center text-sm text-destructive">{error}</p> : null}
          {!error && rows.length === 0 && !loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{labels.empty}</p>
          ) : null}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {rows
              .filter((row) => row.url)
              .map((row) => {
                const name = row.name ?? row.filename ?? row.key ?? row.url ?? "";
                return (
                  <button
                    key={row.key ?? row.url}
                    type="button"
                    title={name}
                    onClick={() => {
                      onPick({ url: row.url!, name, size: row.size, width: row.width, height: row.height });
                      onOpenChange(false);
                    }}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-md border border-border bg-muted transition hover:ring-2 hover:ring-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {kind === "video" ? (
                      <div className="grid h-full w-full place-items-center text-muted-foreground">
                        <Film className="h-7 w-7" />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-1.5 py-0.5 text-left text-[10px] text-foreground">
                      {name}
                    </span>
                  </button>
                );
              })}
          </div>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
        {cursor && !loading ? (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void load(cursor)}>
            {labels.loadMore}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
