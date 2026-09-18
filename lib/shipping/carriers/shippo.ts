import {
  CARRIER_ERROR_CODES,
  CarrierError,
  type CarrierFailure,
} from "./errors";
import { normalizeShippoStatus } from "./status-map";
import type {
  CarrierAdapter,
  CarrierAddress,
  CarrierContext,
  CarrierLabel,
  CarrierParcel,
  CarrierRateQuote,
  CarrierShipmentRequest,
  CarrierTracking,
  CarrierTrackingEvent,
  CarrierWebhookEnvelope,
} from "./types";
import { shippoOriginHint } from "@/lib/shipping/carrier-config";
import { normalizeCountryCode } from "./address";
import {
  shippoCreateCustomsDeclaration,
  shippoCreateShipment,
  shippoCreateTransaction,
  shippoFindTransactionForRate,
  shippoGetRate,
  shippoGetTransaction,
  shippoMessageText,
  shippoRefundTransaction,
  shippoTrack,
  shippoValidateAddress,
  shippoWhoAmI,
  transactionRateId,
  type ShippoAddress,
  type ShippoCustomsItem,
  type ShippoParcel,
  type ShippoRate,
  type ShippoTrackingStatus,
  type ShippoTransaction,
} from "./shippo-client";

function requireToken(ctx: CarrierContext): string {
  if (!ctx.token) {
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.NOT_CONFIGURED,
      message: `No Shippo ${ctx.mode} API token is configured`,
      permanent: true,
    });
  }
  return ctx.token;
}

function toShippoAddress(address: CarrierAddress): ShippoAddress {
  return {
    name: address.name,
    company: address.company,
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.postalCode,
    country: address.country,
    phone: address.phone,
    email: address.email,
  };
}

function toShippoParcel(parcel: CarrierParcel): ShippoParcel {
  return {
    length: String(parcel.length),
    width: String(parcel.width),
    height: String(parcel.height),
    distance_unit: parcel.dimensionUnit,
    weight: String(parcel.weight),
    mass_unit: parcel.weightUnit,
  };
}

function toQuote(rate: ShippoRate, shipmentId: string): CarrierRateQuote {
  return {
    provider: "shippo",
    rateId: rate.object_id,
    shipmentId,
    carrierName: rate.provider,
    serviceName: rate.servicelevel?.name || rate.provider,
    serviceToken: rate.servicelevel?.token,
    amount: Number(rate.amount) || 0,
    currency: String(rate.currency || "USD").toUpperCase(),
    estimatedDays: rate.estimated_days,
    attributes: rate.attributes,
  };
}

/**
 * Map the middle language's customs lines onto Shippo's.
 *
 * Pure and exported for tests: the two things most easily got wrong here —
 * `net_weight` being a line total rather than a unit weight, and an origin
 * country that has to be alpha-2 — are both invisible until a real
 * international label is refused.
 */
export function toShippoCustomsItems(
  request: CarrierShipmentRequest,
): ShippoCustomsItem[] {
  return (request.customsItems || []).map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity) || 1);
    const lineWeight = Number(item.netWeight) * quantity;

    return {
      description: (item.description || "Merchandise").slice(0, 200),
      quantity,
      // Shippo wants the weight of the whole line, not of one unit.
      net_weight: String(lineWeight > 0 ? lineWeight : 0.01),
      mass_unit: item.weightUnit,
      value_amount: String(Number(item.valueAmount) || 0),
      value_currency: item.valueCurrency,
      // A product that declares no country of origin is treated as made where
      // it is dispatched from — the honest default, and Shippo rejects a blank.
      origin_country:
        normalizeCountryCode(item.originCountry) || request.shipFrom.country,
      tariff_number: item.hsCode || undefined,
    };
  });
}

/**
 * The declaration id for a cross-border shipment, or undefined for a domestic
 * one. `build-request` populates `customsItems` only when the countries differ,
 * so its presence is the whole test.
 */
async function customsDeclarationFor(
  token: string,
  request: CarrierShipmentRequest,
): Promise<string | undefined> {
  const items = toShippoCustomsItems(request);
  if (items.length === 0) return undefined;

  const declaration = await shippoCreateCustomsDeclaration({
    token,
    items,
    signer: request.shipFrom.name,
  });
  return declaration.object_id;
}

/**
 * Carriers whose Shippo token is not just their name slugged.
 *
 * Small on purpose: the slug below is right for the overwhelming majority, and
 * a map pretending to be exhaustive would rot silently as Shippo adds carriers.
 */
const SHIPPO_CARRIER_TOKEN_OVERRIDES: Record<string, string> = {
  "apc postal logistics": "apc",
  "dhl ecommerce": "dhl_ecommerce",
  "dhl ecommerce solutions": "dhl_ecommerce",
  "lone star overnight": "lso",
  "usps returns": "usps",
};

/**
 * A rate's carrier as Shippo's tracking endpoint wants it.
 *
 * `GET /tracks/{carrier}/{number}` keys on a carrier *token* — `dhl_express`,
 * `canada_post` — while a rate reports its carrier as a display name, "DHL
 * Express". Lower-casing alone is correct only for the single-word carriers,
 * which is exactly the set a US test account sees: USPS, UPS, FedEx. Every
 * multi-word carrier 4xx'd on every poll, burned the retry ladder and left the
 * parcel with no tracking at all — invisible unless you shipped one.
 *
 * Exported for tests, because that blind spot is the whole point of the fix.
 */
export function shippoCarrierToken(carrierName: string): string {
  const name = carrierName
    // NFD splits an accented letter into a plain one plus a combining mark,
    // which the ASCII filter then drops, so "Correos Espana" reaches the slug
    // whole. Slugging the accented form directly would give "correos espa_a":
    // the accent is not [a-z0-9], so it would become a separator of its own.
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .trim()
    .toLowerCase();

  const override = SHIPPO_CARRIER_TOKEN_OVERRIDES[name];
  if (override) return override;

  return name.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Shippo's refusal list, compressed to the reasons that actually differ.
 *
 * A shipment with no rates comes back with one message *per carrier account* —
 * fifteen on a stock account, most of them the same sentence carrying a
 * different account id. Joined verbatim that is ~1,500 characters in which the
 * line explaining the failure is buried among fourteen that repeat each other.
 *
 * Grouping is done on the sentence with the account identifiers stripped, so
 * the repeats collapse to one representative and every genuinely distinct
 * reason survives. Ordering is Shippo's own: it lists per account, and there is
 * no signal in the payload saying which reason is the decisive one.
 *
 * Exported for tests — the compression is the whole point, and it is invisible
 * until a real shipment has no rates.
 */
export function summariseShippoRefusals(
  messages: Array<{ text?: string; code?: string }> | undefined,
  limit = 4,
): string | undefined {
  const texts = (messages || [])
    .map((message) => (message.text || message.code || "").trim())
    .filter(Boolean);
  if (texts.length === 0) return undefined;

  const byReason = new Map<string, string>();
  for (const text of texts) {
    const stripped = text
      .toLowerCase()
      // Account ids — `shippo_dpd_uk_account`, `COURIERSPLEASE_SHIPPO_TIER_1` —
      // are the only thing making otherwise identical refusals look distinct.
      .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // A message that is *nothing but* an identifier strips to the empty string
    // — which happens whenever `text` is absent and the bare `code` is all we
    // have. Keyed on that, every distinct code would collapse into one entry
    // and the rest would vanish without even a "(+N more)" to show for it.
    if (!byReason.has(stripped || text.toLowerCase())) {
      byReason.set(stripped || text.toLowerCase(), text);
    }
  }

  const reasons = Array.from(byReason.values());
  const shown = reasons.slice(0, limit);
  const hidden = reasons.length - shown.length;
  const summary = shown.join("; ");
  return hidden > 0 ? `${summary} (+${hidden} more)` : summary;
}

/**
 * What to tell a merchant when Shippo quoted nothing.
 *
 * The provider's own refusals, compressed, behind a lead sentence that names
 * the likely cause when the origin is outside Shippo's default coverage.
 * Shippo never says that itself: it reports per carrier account, so a store
 * with no carrier where it stands is told fifteen times that fifteen accounts
 * declined, and not once that it holds none which could have accepted.
 */
export function shippoNoRatesMessage(
  originCountry: string | undefined,
  messages: Array<{ text?: string; code?: string }> | undefined,
): string {
  return (
    [shippoOriginHint(originCountry), summariseShippoRefusals(messages)]
      .filter(Boolean)
      .join(" ") || "No Shippo rates are available for this shipment"
  );
}

function trackingEvent(entry: ShippoTrackingStatus): CarrierTrackingEvent {
  const location = [
    entry.location?.city,
    entry.location?.state,
    entry.location?.country,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    at: entry.status_date ? new Date(entry.status_date) : new Date(),
    status: normalizeShippoStatus(entry.status, entry.substatus?.code),
    providerStatus: entry.status || undefined,
    description: entry.status_details || entry.substatus?.text || undefined,
    location: location || undefined,
  };
}

function labelFromTransaction(
  transaction: ShippoTransaction,
  ctx: CarrierContext,
  carrierName: string,
  serviceName?: string,
  /** Set only when the label was bought against a rate other than the quote. */
  rate?: ShippoRate,
): CarrierLabel {
  if (transaction.status === "ERROR") {
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message:
        shippoMessageText(transaction.messages) ||
        "Shippo could not purchase this label",
      // The rate was bad or the address was rejected; retrying it as-is only
      // repeats the same refusal.
      permanent: true,
    });
  }
  if (transaction.status !== "SUCCESS" || !transaction.label_url) {
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: `Shippo label is still ${transaction.status.toLowerCase()}`,
      permanent: false,
      retryAfterSeconds: 15,
    });
  }

  const bought = rate ? toQuote(rate, "") : undefined;
  return {
    transactionId: transaction.object_id,
    trackingNumber: transaction.tracking_number || "",
    trackingUrl: transaction.tracking_url_provider,
    labelUrl: transaction.label_url,
    labelFormat: ctx.shippo?.labelFileType || "PDF_4x6",
    carrierName: bought?.carrierName ?? carrierName,
    serviceName: bought?.serviceName ?? serviceName,
    rateId: bought?.rateId,
    serviceToken: bought?.serviceToken,
    amount: bought?.amount,
    currency: bought?.currency,
    estimatedDays: bought?.estimatedDays,
    resume: {
      providerTransactionId: transaction.object_id,
      trackingNumber: transaction.tracking_number,
      labelUrl: transaction.label_url,
    },
  };
}

/**
 * Write the transaction down the moment Shippo has created it.
 *
 * Shippo charges when the transaction is created, not when we record it. Before
 * this, the handle existed only in the success write at the end of the
 * purchase — so a function killed between the two left a paid label with no
 * trace on the parcel. The claim then went stale, the quotes expired, and the
 * retry bought a second label against a fresh rate: two charges, one of them
 * never voidable because nothing pointed at it.
 *
 * Skipped for an ERROR transaction, which charged nothing and must not become
 * the resume state every later retry reads back.
 */
async function checkpointTransaction(
  params: Parameters<CarrierAdapter["purchaseLabel"]>[1],
  transaction: ShippoTransaction,
) {
  if (!transaction?.object_id || transaction.status === "ERROR") return;
  await params
    .onProgress?.({
      providerTransactionId: transaction.object_id,
      trackingNumber: transaction.tracking_number || undefined,
      labelUrl: transaction.label_url || undefined,
    })
    .catch(() => undefined);
}

/**
 * The rate a resumed transaction was really bought against.
 *
 * Undefined when it is the quote in hand, or when it cannot be read — the
 * label itself is what matters, and failing a purchase that already succeeded
 * because a secondary lookup did would strand it again.
 */
async function boughtRate(
  token: string,
  transaction: ShippoTransaction,
  quote: CarrierRateQuote,
): Promise<ShippoRate | undefined> {
  const rateId = transactionRateId(transaction);
  if (!rateId || rateId === quote.rateId) return undefined;
  if (typeof transaction.rate === "object" && transaction.rate?.amount) {
    return transaction.rate;
  }
  return shippoGetRate({ token, rateId }).catch(() => undefined);
}

export const shippoAdapter: CarrierAdapter = {
  provider: "shippo",

  supports() {
    // Shippo carries carrier accounts for most of the world; whether a given
    // lane is serviceable is answered by the rate list, not by us guessing.
    //
    // Origin is no exception, tempting as it looks. Shippo's *own* accounts
    // collect from eight countries, but DHL Express, FedEx and UPS originate
    // worldwide on a merchant's own account and Shippo documents no origin
    // limit for one. Refusing here on the master-account list would turn away
    // precisely the merchant who had connected a carrier to make their lane
    // work. The explanation belongs on the refusal instead — `shippoOriginHint`.
    return true;
  },

  async getRates(ctx, request) {
    const token = requireToken(ctx);
    // Both objects are inert descriptions, not consignments: nothing is booked
    // and nothing is charged, which is what keeps rate shopping side-effect
    // free even though it writes to Shippo.
    const customsDeclaration = await customsDeclarationFor(token, request);
    const shipment = await shippoCreateShipment({
      token,
      addressFrom: toShippoAddress(request.shipFrom),
      addressTo: toShippoAddress(request.shipTo),
      parcels: request.parcels.map(toShippoParcel),
      customsDeclaration,
      metadata: request.reference,
    });

    const quoted = shipment.rates || [];
    const allow = ctx.shippo?.serviceTokenAllowList;
    const rates = quoted.filter((rate) => {
      if (!allow || allow.length === 0) return true;
      const token = rate.servicelevel?.token;
      return Boolean(token && allow.includes(token));
    });

    if (rates.length === 0) {
      throw new CarrierError({
        provider: "shippo",
        code: CARRIER_ERROR_CODES.NO_RATES,
        // Which of the two emptied the list matters, because they send the
        // merchant to opposite screens. Shippo quoting nothing is a carrier
        // problem — hence the coverage hint. Shippo quoting and the store's own
        // allow-list taking every one of them is a settings problem, and
        // telling that merchant to go connect a carrier account would be
        // advice to fix something that already works.
        message:
          quoted.length === 0
            ? shippoNoRatesMessage(request.shipFrom.country, shipment.messages)
            : `Shippo quoted ${quoted.length} rate${
                quoted.length === 1 ? "" : "s"
              } for this shipment and your service allow-list excluded all of them. Widen it in Settings → Shipping.`,
        permanent: true,
      });
    }

    return rates.map((rate) => toQuote(rate, shipment.object_id));
  },

  async purchaseLabel(ctx, params) {
    const token = requireToken(ctx);
    const { quote, resume } = params;

    // A retry that already has a transaction id only needs to read it back;
    // Shippo transactions are immutable, so re-buying would error rather than
    // return the label we already paid for.
    if (resume?.providerTransactionId) {
      const existing = await shippoGetTransaction({
        token,
        transactionId: resume.providerTransactionId,
      });
      // An ERROR transaction charged nothing, so there is nothing to resume:
      // clinging to it would fail every retry the same way for good. Buying
      // afresh against the quote in hand is what the retry was for.
      if (existing.status !== "ERROR") {
        return labelFromTransaction(
          existing,
          ctx,
          quote.carrierName,
          quote.serviceName,
          await boughtRate(token, existing, quote),
        );
      }
    }

    let transaction: ShippoTransaction;
    try {
      transaction = await shippoCreateTransaction({
        token,
        rateId: quote.rateId,
        labelFileType: ctx.shippo?.labelFileType || "PDF_4x6",
        metadata: params.idempotencyKey,
      });
    } catch (error) {
      // A rate can only be bought once. If the previous attempt succeeded but
      // we never saw the response, recover it rather than reporting failure.
      const recovered = await shippoFindTransactionForRate({
        token,
        rateId: quote.rateId,
      }).catch(() => null);
      if (recovered?.status === "SUCCESS") {
        await checkpointTransaction(params, recovered);
        return labelFromTransaction(
          recovered,
          ctx,
          quote.carrierName,
          quote.serviceName,
        );
      }
      throw error;
    }

    await checkpointTransaction(params, transaction);
    return labelFromTransaction(
      transaction,
      ctx,
      quote.carrierName,
      quote.serviceName,
    );
  },

  async track(ctx, params) {
    const token = requireToken(ctx);
    if (!params.carrierName) {
      throw new CarrierError({
        provider: "shippo",
        code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
        message: "Shippo tracking needs the carrier name",
        permanent: true,
      });
    }
    const track = await shippoTrack({
      token,
      carrier: shippoCarrierToken(params.carrierName),
      trackingNumber: params.trackingNumber,
    });

    const history = (track.tracking_history || []).map(trackingEvent);
    const current = track.tracking_status
      ? trackingEvent(track.tracking_status)
      : undefined;
    const events = current
      ? [
          ...history.filter(
            (event) => event.at.getTime() !== current.at.getTime(),
          ),
          current,
        ]
      : history;
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    const tracking: CarrierTracking = {
      status: current?.status ?? events[events.length - 1]?.status ?? "unknown",
      eta: track.eta ? new Date(track.eta) : undefined,
      events,
    };
    return tracking;
  },

  async voidLabel(ctx, params) {
    const token = requireToken(ctx);
    if (!params.transactionId) {
      throw new CarrierError({
        provider: "shippo",
        code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
        message: "This shipment has no Shippo transaction to refund",
        permanent: true,
      });
    }
    const refund = await shippoRefundTransaction({
      token,
      transactionId: params.transactionId,
    });
    // Shippo queues refunds — SUCCESS means accepted, not yet credited.
    return {
      refunded: refund.status === "SUCCESS" || refund.status === "QUEUED",
      state: String(refund.status || "QUEUED"),
    };
  },

  async validateAddress(ctx, address) {
    const token = requireToken(ctx);
    const result = await shippoValidateAddress({
      token,
      address: toShippoAddress(address),
    });
    const messages = (result.validation_results?.messages || [])
      .map((message) => message.text || message.code)
      .filter((text): text is string => Boolean(text));
    return {
      valid: result.validation_results?.is_valid !== false,
      messages,
      normalized: result.street1
        ? {
            ...address,
            street1: result.street1,
            street2: result.street2 || address.street2,
            city: result.city || address.city,
            state: result.state || address.state,
            postalCode: result.zip || address.postalCode,
            country: (result.country || address.country).toUpperCase(),
          }
        : undefined,
    };
  },

  async testConnection(ctx) {
    const token = requireToken(ctx);
    const who = await shippoWhoAmI(token);
    return { ok: true as const, account: who.account, mode: ctx.mode };
  },

  classify(error): CarrierFailure | undefined {
    if (error instanceof CarrierError && error.provider === "shippo") {
      return error.toFailure();
    }
    return undefined;
  },

  parseWebhook({ rawBody }): CarrierWebhookEnvelope | null {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const body = payload as {
      event?: string;
      test?: boolean;
      data?: {
        object_id?: string;
        tracking_number?: string;
        tracking_status?: { status?: string; status_date?: string };
        carrier?: string;
      };
    };
    if (!body?.event || !body.data) return null;

    const objectId = body.data.object_id;
    const status = body.data.tracking_status?.status || "";
    const statusDate = body.data.tracking_status?.status_date || "";

    // Shippo sends no event id, so one is synthesised from the parts that
    // change per event. Two deliveries of the same status at the same instant
    // are the same event and must be de-duplicated.
    const eventId =
      `${body.event}:${objectId || body.data.tracking_number || ""}:${status}:${statusDate}`.slice(
        0,
        200,
      );

    return {
      provider: "shippo",
      eventId,
      type: body.event,
      objectId,
      trackingNumber: body.data.tracking_number,
      transactionId: body.event.startsWith("transaction")
        ? objectId
        : undefined,
      test: body.test === true,
    };
  },
};
