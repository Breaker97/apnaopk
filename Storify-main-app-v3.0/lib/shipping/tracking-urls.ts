/**
 * Where to send someone who wants to watch a hand-entered parcel move.
 *
 * A carrier-booked shipment gets its tracking page from the provider, which is
 * authoritative and needs nothing from us. A parcel typed in by hand gets
 * nothing at all — so the AWB sat on the customer's screen as dead text, which
 * is the whole of what a shopper can do with it.
 *
 * Deliberately NOT server-only: the admin parcel list resolves the same link
 * in the browser, and one copy of this rule is the point.
 */

/** A courier name and where its tracking page lives, as a merchant sets it. */
export interface CourierTrackingLink {
  /** Matched case-insensitively as a substring of the carrier's name. */
  carrier: string;
  /**
   * `{tracking}` is replaced with the AWB. A template naming no placeholder
   * gets the AWB appended, which is what a merchant pasting a bare prefix
   * meant.
   */
  urlTemplate: string;
}

const PLACEHOLDER = "{tracking}";

/**
 * The couriers we ship a link for out of the box.
 *
 * Kept short on purpose. A tracking URL that 404s is worse than no link — the
 * shopper blames the store, not the courier — so this holds only patterns
 * stable enough to rely on, and every other courier is the merchant's to
 * configure. Order matters: the first match wins, so a more specific name is
 * listed above the family it belongs to.
 */
const BUILT_IN: Array<{ match: RegExp; template: string }> = [
  // Ours already, from the Shiprocket adapter — same URL it stamps on a label.
  { match: /shiprocket/i, template: `https://shiprocket.co/tracking/${PLACEHOLDER}` },
  {
    match: /blue\s*dart/i,
    template: `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${PLACEHOLDER}`,
  },
  {
    match: /delhivery/i,
    template: `https://www.delhivery.com/track/package/${PLACEHOLDER}`,
  },
  {
    match: /\bdhl\b/i,
    template: `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${PLACEHOLDER}`,
  },
  {
    match: /fedex/i,
    template: `https://www.fedex.com/fedextrack/?trknbr=${PLACEHOLDER}`,
  },
  {
    match: /\bups\b/i,
    template: `https://www.ups.com/track?loc=en_US&tracknum=${PLACEHOLDER}`,
  },
  {
    match: /usps|united\s*states\s*postal/i,
    template: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${PLACEHOLDER}`,
  },
  {
    match: /royal\s*mail/i,
    template: `https://www.royalmail.com/track-your-item#/tracking-results/${PLACEHOLDER}`,
  },
  {
    match: /canada\s*post|postes\s*canada/i,
    template: `https://www.canadapost-postescanada.ca/track-reperage/en#/resultList?searchFor=${PLACEHOLDER}`,
  },
  {
    match: /australia\s*post|auspost/i,
    template: `https://auspost.com.au/mypost/track/details/${PLACEHOLDER}`,
  },
  {
    match: /aramex/i,
    template: `https://www.aramex.com/us/en/track/results?ShipmentNumber=${PLACEHOLDER}`,
  },
];

/** Fill a template, appending the AWB when the template names no placeholder. */
function fillTemplate(template: string, trackingNumber: string): string {
  const encoded = encodeURIComponent(trackingNumber);
  return template.includes(PLACEHOLDER)
    ? template.split(PLACEHOLDER).join(encoded)
    : `${template}${encoded}`;
}

/**
 * Only http(s), and only a URL that parses.
 *
 * The template is merchant-supplied and lands in an `href`, so `javascript:`
 * and friends have to die here rather than in whichever component renders it.
 */
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The tracking page for a parcel, or nothing.
 *
 * Nothing is a perfectly good answer: an unrecognised courier with no
 * configured link renders as plain text, exactly as it did before.
 */
export function trackingPageUrl(params: {
  carrier?: string;
  trackingNumber?: string;
  /** Merchant-configured couriers, which outrank the built-in list. */
  links?: CourierTrackingLink[];
}): string | undefined {
  const carrier = params.carrier?.trim();
  const trackingNumber = params.trackingNumber?.trim();
  if (!carrier || !trackingNumber) return undefined;

  const haystack = carrier.toLowerCase();

  // The merchant's own list first: a store shipping DHL through a local agent
  // has a different page to send people to than dhl.com, and their answer must
  // win over ours.
  for (const link of params.links || []) {
    const needle = link.carrier?.trim().toLowerCase();
    if (!needle || !link.urlTemplate?.trim()) continue;
    if (haystack.includes(needle)) {
      return safeUrl(fillTemplate(link.urlTemplate.trim(), trackingNumber));
    }
  }

  for (const entry of BUILT_IN) {
    if (entry.match.test(carrier)) {
      return safeUrl(fillTemplate(entry.template, trackingNumber));
    }
  }

  return undefined;
}

/** The couriers this build links without any configuration, for the settings copy. */
export const BUILT_IN_TRACKING_COURIERS = [
  "Shiprocket",
  "Blue Dart",
  "Delhivery",
  "DHL",
  "FedEx",
  "UPS",
  "USPS",
  "Royal Mail",
  "Canada Post",
  "Australia Post",
  "Aramex",
] as const;
