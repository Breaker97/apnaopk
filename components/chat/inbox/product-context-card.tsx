import Link from "next/link";
import { Package } from "lucide-react";
import type { ConversationDTO } from "@/lib/conversations/types";

interface ProductContextCardProps {
  locale: string;
  product: NonNullable<ConversationDTO["productContext"]>;
  viewProductLabel: string;
}

/**
 * The product a conversation is about, linking back to its page. Shared by the
 * details panel and the new-conversation pane, so the shopper sees the same
 * card before the first message as after it.
 */
export function ProductContextCard({
  locale,
  product,
  viewProductLabel,
}: ProductContextCardProps) {
  return (
    <Link
      href={`/${locale}/products/${product.slug}`}
      className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-muted/60"
    >
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" className="size-full object-cover" />
        ) : (
          <Package className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {product.name}
        </span>
        {product.variantName ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {product.variantName}
          </span>
        ) : (
          <span className="block text-[11px] text-primary">
            {viewProductLabel}
          </span>
        )}
      </span>
    </Link>
  );
}
