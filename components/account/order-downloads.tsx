"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DigitalDownloadFile {
  assetId: string;
  productName: string;
  filename: string;
  size?: number;
  downloadLimit: number;
  downloadedCount: number;
  remainingDownloads: number | null;
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes && bytes !== 0) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Digital files an order grants access to. Renders nothing for orders
 * without digital items; the server only lists files once the order is paid.
 *
 * `orderId` may be the Mongo _id or the orderNumber (the success page often
 * only has the latter). Pass `paymentStatus` when known to skip a pointless
 * fetch on unpaid orders; omit it to let the server decide (used on the
 * checkout success page, where a confirmed payment implies paid).
 */
export function OrderDownloads({
  orderId,
  paymentStatus,
}: {
  orderId: string;
  paymentStatus?: string;
}) {
  const [files, setFiles] = useState<DigitalDownloadFile[]>([]);

  useEffect(() => {
    if (paymentStatus !== undefined && paymentStatus !== "paid") return;
    let cancelled = false;
    async function fetchDownloads() {
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/downloads`,
        );
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.data?.files)) {
          setFiles(data.data.files);
        }
      } catch {
        // Downloads must not block order rendering.
      }
    }
    void fetchDownloads();
    return () => {
      cancelled = true;
    };
  }, [orderId, paymentStatus]);

  if (files.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Downloads</CardTitle>
        <CardDescription>
          Digital files included with this order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {files.map((file) => {
            const exhausted = file.remainingDownloads === 0;
            const sizeLabel = formatFileSize(file.size);
            return (
              <div
                key={file.assetId}
                className="flex items-center gap-4 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.productName}
                    {sizeLabel ? ` · ${sizeLabel}` : ""}
                    {file.remainingDownloads !== null
                      ? ` · ${file.remainingDownloads} of ${file.downloadLimit} downloads left`
                      : ""}
                  </p>
                </div>
                {exhausted ? (
                  <Badge variant="outline">Limit reached</Badge>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/orders/${encodeURIComponent(orderId)}/downloads/${file.assetId}`}
                      onClick={() => {
                        // Reflect the spent download locally so a limited
                        // file's counter stays honest without a refetch.
                        setFiles((prev) =>
                          prev.map((f) =>
                            f.assetId === file.assetId &&
                            f.remainingDownloads !== null
                              ? {
                                  ...f,
                                  downloadedCount: f.downloadedCount + 1,
                                  remainingDownloads: Math.max(
                                    0,
                                    f.remainingDownloads - 1,
                                  ),
                                }
                              : f,
                          ),
                        );
                      }}
                    >
                      <Download className="mr-1.5 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
