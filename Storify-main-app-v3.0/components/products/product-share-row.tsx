import type { CSSProperties } from "react";
import { Mail, Share2 } from "lucide-react";
import {
  buildCustomShareUrl,
  type ShareSettings,
} from "@/lib/site-config/share-config";
import type { ProductDetailShareNetwork } from "@/lib/storefront/sections/product-detail-style";
import { cn } from "@/lib/utils";
import { ProductIsland } from "./product-details-lazy";
import { SHARE_NETWORKS, shareEmailHref } from "./share-networks";

/** The gray rounded tile each share control sits on. */
const TILE =
  "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/70";

type Translate = (key: string, fallback: string) => string;

interface ProductShareRowProps {
  /** The product page's canonical address — what is shared. */
  url: string;
  productName: string;
  image?: string;
  settings: ShareSettings;
  /** The page's own switches; the store's settings decide what exists. */
  networks: Record<ProductDetailShareNetwork, boolean>;
  tileStyle: CSSProperties;
  tf: Translate;
}

/**
 * The product page's share row, drawn on the server.
 *
 * Sharing is a link, so it needs no code: the product page used to load the
 * whole share component and every network's brand mark as script (~15 KB) to
 * draw what is now plain markup, and its links pointed nowhere until that
 * script had run. Only "copy link" answers to a click, and it is the one
 * island here. The page's canonical address is what is shared, not the
 * address bar: a shopper's filters, location or campaign tags stay theirs.
 *
 * The seller page's share popover is still ProductShareButtons; both take
 * their networks from share-networks.ts.
 */
export function ProductShareRow({
  url,
  productName,
  image,
  settings,
  networks,
  tileStyle,
  tf,
}: ProductShareRowProps) {
  const allowed = (key: string) =>
    (networks as Record<string, boolean | undefined>)[key] !== false;
  const target = { url, title: productName, image };

  const shown = SHARE_NETWORKS.filter(
    (network) => settings[network.key] && allowed(network.key),
  );
  const custom = settings.custom
    .filter(
      (item) => item.enabled && item.label.trim() && item.urlTemplate.trim(),
    )
    .map((item) => ({
      id: item.id,
      label: item.label.trim(),
      iconUrl: item.icon?.trim() || "",
      href: buildCustomShareUrl(item.urlTemplate, target),
    }))
    .filter((item) => item.href);
  const showEmail = settings.email && allowed("email");
  const showCopy = settings.copyLink && allowed("copyLink");

  if (
    !settings.enabled ||
    (shown.length === 0 && custom.length === 0 && !showEmail && !showCopy)
  ) {
    return null;
  }

  const plain = "hover:border-foreground hover:text-foreground";

  return (
    <div className="space-y-2.5">
      {/* `product.share` is a NAMESPACE (facebook/twitter/…), so the heading
          reads its `label` leaf — `t.has` answers true for the namespace
          itself and would render the raw key. */}
      <p className="text-sm font-semibold text-foreground">
        {tf("product.share.label", "Share")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((network) => {
          const label = tf(network.labelKey, network.fallbackLabel);
          const Icon = network.icon;
          return (
            <a
              key={network.key}
              href={network.href(target)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              className={cn(TILE, network.brandClass)}
              style={tileStyle}
            >
              <Icon className="h-4 w-4" />
            </a>
          );
        })}

        {custom.map((link) => (
          <a
            key={link.id}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label}
            title={link.label}
            className={cn(TILE, plain)}
            style={tileStyle}
          >
            {link.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={link.iconUrl}
                alt=""
                className="h-4 w-4 object-contain"
                aria-hidden
              />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
          </a>
        ))}

        {showEmail ? (
          <a
            href={shareEmailHref({
              ...target,
              text: tf(
                "product.shareProduct",
                "Share this product with friends and family",
              ),
            })}
            aria-label={tf("product.share.email", "Share via email")}
            title={tf("product.share.email", "Share via email")}
            className={cn(TILE, plain)}
            style={tileStyle}
          >
            <Mail className="h-4 w-4" />
          </a>
        ) : null}

        {showCopy ? (
          <ProductIsland
            island="copyLink"
            url={url}
            label={tf("product.share.copyLink", "Copy link")}
            copiedLabel={tf("product.share.copied", "Link copied")}
            failedLabel={tf("common.error", "Something went wrong")}
            className={cn(TILE, plain)}
            style={tileStyle}
          />
        ) : null}
      </div>
    </div>
  );
}
