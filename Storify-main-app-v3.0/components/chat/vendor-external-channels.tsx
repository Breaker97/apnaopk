import {
  Instagram,
  MessageCircle,
  Send,
  SendHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  vendorInstagramUrl,
  vendorMessengerUrl,
  vendorTelegramUrl,
  vendorWhatsAppUrl,
  type VendorMessagingSettings,
} from "@/lib/notifications/vendor-messaging";

interface VendorExternalChannelsProps {
  settings: VendorMessagingSettings;
  vendorName: string;
  productName?: string;
  compact?: boolean;
  /**
   * Localised template for the icon-only aria-label, with {vendor} and
   * {channel} placeholders. Passed in because this renders from both server and
   * client components, so it cannot resolve translations itself.
   */
  chatOnLabel?: string;
  /**
   * Localised WhatsApp prefill templates, with {vendor} and {product}
   * placeholders. Passed in for the same reason as `chatOnLabel`.
   */
  whatsappProductMessage?: string;
  whatsappStoreMessage?: string;
  /**
   * Button styling. `ghost` where these are secondary controls — the storefront
   * header, where Follow is the one filled button — `outline` everywhere else.
   */
  variant?: "outline" | "ghost";
}

export function VendorExternalChannels({
  settings,
  vendorName,
  productName,
  compact = false,
  chatOnLabel = "Chat with {vendor} on {channel}",
  whatsappProductMessage = "Hello {vendor}, I have a question about {product}.",
  whatsappStoreMessage = "Hello {vendor}, I have a question about your store.",
  variant = "outline",
}: VendorExternalChannelsProps) {
  // One row per public click-to-chat destination, so a channel is added here by
  // adding a link rather than by copying a button block.
  const links = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: vendorWhatsAppUrl(
        settings,
        productName
          ? whatsappProductMessage
              .replace("{vendor}", vendorName)
              .replace("{product}", productName)
          : whatsappStoreMessage.replace("{vendor}", vendorName),
      ),
      icon: <MessageCircle className="text-emerald-600" />,
    },
    {
      key: "messenger",
      label: "Messenger",
      href: vendorMessengerUrl(settings),
      icon: <Send className="text-blue-600" />,
    },
    {
      key: "telegram",
      label: "Telegram",
      href: vendorTelegramUrl(settings),
      icon: <SendHorizontal className="text-sky-500" />,
    },
    {
      key: "instagram",
      label: "Instagram",
      href: vendorInstagramUrl(settings),
      icon: <Instagram className="text-pink-600" />,
    },
  ].filter((link) => Boolean(link.href));

  if (!links.length) return null;

  return (
    <>
      {links.map((link) => (
        <Button
          key={link.key}
          asChild
          type="button"
          variant={variant}
          size={compact ? "icon" : "lg"}
          className={cn(
            compact ? "size-9 rounded-full" : "h-11 flex-1 rounded-sm",
            variant === "ghost" && "text-muted-foreground",
          )}
        >
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              compact
                ? chatOnLabel
                    .replace("{vendor}", vendorName)
                    .replace("{channel}", link.label)
                : undefined
            }
          >
            {link.icon}
            {!compact ? link.label : null}
          </a>
        </Button>
      ))}
    </>
  );
}
