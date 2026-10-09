"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import {
  Archive,
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  CircleEllipsis,
  ClipboardCheck,
  Eye,
  FileText,
  MapPin,
  Truck,
  MoreHorizontal,
  PackagePlus,
  RefreshCcw,
  Scale,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast-notification";
import { DataTablePagination } from "@/components/ui/data-table";
import { CopyTrackingNumber } from "@/components/shipping/parcel-tracking";
import { ReturnExchangeDialog } from "@/components/admin/returns/return-exchange-dialog";
import {
  currencyPriceScale,
  formatCurrency,
  quantizeToCurrency,
} from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import {
  describeRefundDestination,
  getRefundDestinationLabel,
  type RefundDestinationInput,
} from "@/lib/returns/refund-settlement";
import {
  RETURN_LABEL_ACCEPT,
  RETURN_METHOD_CHANGEABLE_STATUSES,
  RETURN_SHIPPING_OPEN_STATUSES,
  describeReturnDestination,
  returnMethodOf,
  type ReturnMethod,
} from "@/lib/returns/return-shipping";
import {
  RETURN_DECLINE_MESSAGES,
  RETURN_DECLINE_REASON_LABELS,
  RETURN_DECLINE_REASONS,
  isReturnDeclineReason,
  returnGoodsBack,
  returnMayRestock,
  returnRestockPlan,
  returnRestockProgress,
  type ReturnDeclineReason,
} from "@/lib/returns/returns";

/** What `GET /api/<scope>/returns/[id]/return-to` answers with. */
interface ReturnToOptions {
  locations: Array<{
    _id: string;
    name: string;
    address: string;
    isDefault: boolean;
    acceptsReturns: boolean;
  }>;
  defaultLocationId: string | null;
  fallback: { name?: string; address?: string } | null;
}

/**
 * How far the store may go on a return's fees and delivery — what
 * `GET /api/admin/returns/[id]/refund-options` answers with.
 */
interface ReturnRefundOptions {
  currency: string;
  fees: {
    restockingFee: { policy: number; current: number };
    returnShippingFee: { policy: number; current: number };
  };
  delivery: { policy: number; current: number; max: number };
  refunded: number;
  /** Whether the refund can go to the shopper as store credit (R8). */
  storeCredit?: { available: boolean; reason: string | null };
}

/** Where a refund goes (R8). */
type RefundTo = "original" | "store_credit";

const REFUND_TO_CHOICES: Array<{ key: RefundTo; title: string; detail: string }> = [
  {
    key: "original",
    title: "Original payment",
    detail: "Back the way the shopper paid.",
  },
  {
    key: "store_credit",
    title: "Store credit",
    detail: "Added to the shopper's account to spend at checkout. It doesn't expire.",
  },
];

/**
 * One entry in a return row's actions menu: a dialog to open, or a file to
 * open in a new tab.
 */
type RowAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
} & ({ onSelect: () => void } | { href: string });

/**
 * A full-width select sized by its column, never by the address chosen in it —
 * a long one would otherwise widen every grid it sits in, out past the
 * dialog's edge. The value ends in an ellipsis instead.
 */
const SELECT_TRUNCATE =
  "w-full contain-inline-size *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate";

/**
 * A location list that opens under its field and is exactly as wide, long
 * addresses wrapping inside it — laid over the field it grew to the longest
 * one, out past the dialog. Used with `position="popper"`.
 */
const SELECT_LIST = "w-(--radix-select-trigger-width)";

/** A fee or delivery as typed, or the figure it started from when left blank. */
function typedMoney(value: string, fallback: number): number {
  const parsed = Number(value);
  return value.trim() === "" || !Number.isFinite(parsed) ? fallback : Math.max(0, parsed);
}

/** How each way back is described to whoever approves the return. */
const RETURN_METHOD_CHOICES: Array<{
  key: ReturnMethod;
  title: string;
  detail: string;
}> = [
  {
    key: "customer_ships",
    title: "The shopper sends it",
    detail: "They get the address and instructions, and add the tracking number.",
  },
  {
    key: "label",
    title: "We give a return label",
    detail: "Upload the label, or give its link. The shopper prints it.",
  },
  {
    key: "no_shipping",
    title: "Nothing to send back",
    detail: "For a cheap or broken item. Refund it without waiting for a parcel.",
  },
];

/** A short note on how an approved return's parcel is coming back. */
const RETURN_METHOD_NOTES: Record<ReturnMethod, string> = {
  customer_ships: "Shopper posts it",
  label: "Label given",
  no_shipping: "Nothing coming back",
};

interface AdminReturnRequest {
  _id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  customerId?: { name?: string; email?: string };
  /** On a walk-in POS sale: no customer is sent (lib/returns/return-walk-in.ts). */
  posWalkIn?: boolean;
  status: string;
  refundStatus: string;
  reason: string;
  customerNote?: string;
  ownerType?: "admin" | "vendor";
  ownerVendorId?: { storeName?: string } | string | null;
  estimatedRefund: {
    total: number;
    currency: string;
    itemsSubtotal?: number;
    discountAdjustment?: number;
    tax?: number;
    /** Delivery handed back with the goods. */
    shipping?: number;
    restockingFee?: number;
    returnShippingFee?: number;
  };
  /** Why the store declined it — never shown to the shopper. */
  declineReason?: string;
  rejectionReason?: string;
  actualRefund?: {
    amount?: number;
    /** What of `amount` paid for the exchange order (R7). */
    exchange?: number;
    settledMethod?: string;
    settledReference?: string;
    settledAt?: string;
  };
  /** What goes out instead of the money, before it is processed (R7). */
  exchangeItems?: Array<{ name: string; quantity: number }>;
  /** The exchange order the return became (R7). */
  exchange?: {
    orderId: string;
    orderNumber: string;
    owed?: number;
    undoneAt?: string;
  } | null;
  /** Where a refund no gateway can carry should be sent, from the shopper. */
  refundDestination?: RefundDestinationInput;
  /** What the merchant found on inspection, when they have recorded it. */
  faultOverride?: { merchantAtFault?: boolean; note?: string };
  /** Whether the returned units have already been put back on the shelf. */
  inventoryRestored?: boolean;
  /** The parcel coming back, once somebody has recorded it. */
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    /** Who typed the tracking number in. */
    trackingAddedBy?: "customer" | "staff";
    /** A label the store linked to. */
    labelUrl?: string;
    /** A label the store uploaded, opened through the label route. */
    labelFileKey?: string;
    labelFileName?: string;
  };
  /** How the parcel comes back — see lib/returns/return-shipping.ts. */
  returnMethod?: ReturnMethod;
  /** Where the parcel goes, as copied at approval. */
  returnTo?: { locationId?: string; name?: string; address?: string } | null;
  /** When the parcel was counted line by line; until then the counts mean nothing. */
  itemsCountedAt?: string;
  receivedAt?: string;
  inspectedAt?: string;
  /**
   * Whose money this refund comes out of. `vendor` on a cash-on-delivery sale
   * the seller's own van collected — the store never held it, so the seller is
   * the one who hands it back.
   */
  refundPayer?: string;
  items: Array<{
    name: string;
    orderItemIndex: number;
    productId?: string;
    variantId?: string;
    quantityRequested: number;
    quantityApproved?: number;
    quantityReceived?: number;
    /** Units of the line already back on the shelf. */
    quantityRestocked?: number;
    condition?: string;
  }>;
  createdAt: string;
}

interface ReturnsDataTableProps {
  scope?: "admin" | "vendor";
  /**
   * Whether this viewer may move money: issue a refund, re-price a return,
   * record a refund payment the store sent. Admins only — see
   * `canIssueRefunds` — so staff are not offered actions that always fail.
   */
  canIssueRefunds?: boolean;
}

/**
 * An amount in the currency the return was priced in, not whatever the store
 * displays today: after a change of store currency, old returns were labelled
 * with the new one.
 */
function formatReturnMoney(amount: number, currencyCode?: string | null): string {
  const currency = resolveCurrency(String(currencyCode || "").toUpperCase() || "USD");
  return formatCurrency(Number(amount || 0), currency.code, currency.locale);
}

/**
 * Whether a return can still be exchanged (R7): open, with value left, and not
 * already an exchange order that stands.
 */
function returnMayExchange(request: AdminReturnRequest): boolean {
  return (
    [
      "approved",
      "awaiting_shipment",
      "in_transit",
      "received",
      "inspected",
      "refund_pending",
      "partially_refunded",
    ].includes(request.status) &&
    !(request.exchange?.orderId && !request.exchange.undoneAt) &&
    Number(request.estimatedRefund?.total || 0) - Number(request.actualRefund?.amount || 0) > 0.01
  );
}

/** Whether the parcel is back, so its goods can go on the shelf. */
function returnHasArrived(request: {
  status: string;
  itemsCountedAt?: string;
}): boolean {
  return (
    Boolean(request.itemsCountedAt) ||
    ["received", "inspected"].includes(request.status)
  );
}

/**
 * Whose items a return is for, when that is not the store's own.
 *
 * Only ever shown to the admin: a vendor sees their own queue and would be
 * reading their own name back on every row.
 */
function ownerLabel(request: AdminReturnRequest): string | null {
  if (request.ownerType !== "vendor") return null;
  const owner = request.ownerVendorId;
  if (owner && typeof owner === "object" && owner.storeName) return owner.storeName;
  return "Vendor";
}

/** What the inspector found, in words rather than a stored key. */
const CONDITION_LABELS: Record<string, string> = {
  new: "sellable",
  opened: "opened",
  damaged: "damaged",
  missing_parts: "missing parts",
  unusable: "unusable",
};

/** Every state a return can be in, for narrowing the list to one. */
const RETURN_STATUS_FILTERS = [
  "all",
  "requested",
  "approved",
  "awaiting_shipment",
  "in_transit",
  "received",
  "inspected",
  "refund_pending",
  "partially_refunded",
  "refunded",
  "rejected",
  "cancelled",
  "closed",
] as const;

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "rejected" || status === "cancelled") return "destructive";
  if (status === "refunded") return "default";
  if (status === "requested" || status === "refund_pending") return "secondary";
  return "outline";
}

export function ReturnsDataTable({
  scope = "admin",
  canIssueRefunds = scope === "admin",
}: ReturnsDataTableProps) {
  const t = useTranslations();
  // Only the admin area can move money, and there only an admin.
  const mayMoveMoney = scope === "admin" && canIssueRefunds;
  const [returns, setReturns] = useState<AdminReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Paged, and filterable by where a return stands. Only the newest fifty
  // were ever fetched, so an older return — one still owed a hand refund
  // included — could be found only by typing its number.
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [actionReturn, setActionReturn] = useState<AdminReturnRequest | null>(null);
  const [actionType, setActionType] = useState<
    | "reject"
    | "cancel"
    | "close"
    | "refund"
    | "settle"
    | "fault"
    | "receive"
    | "approve"
    | "tracking"
    | "shipping"
    | "restock"
    | null
  >(null);
  const [faultChoice, setFaultChoice] = useState<"merchant" | "customer">(
    "merchant",
  );
  const [note, setNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  // Ticked by default once the parcel is back — a refund issued with it off
  // is stock the shop never recovers — and not before: refunding on approval
  // with it ticked put goods on the shelf that were still with the shopper.
  const [restockOnRefund, setRestockOnRefund] = useState(false);
  // Where the refund goes, and how much of it as store credit (R8). Blank
  // is all of it.
  const [refundTo, setRefundTo] = useState<RefundTo>("original");
  const [creditInput, setCreditInput] = useState("");
  // What the parcel actually held, line by line. Keyed by the order line, so a
  // return covering two of the same product still counts each line on its own.
  const [countedItems, setCountedItems] = useState<
    Record<number, { quantity: string; condition: string }>
  >({});
  // How much of each line the store agrees to take back. Defaults to what was
  // asked for, so approving without touching anything means "all of it".
  const [approvedItems, setApprovedItems] = useState<Record<number, string>>({});
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [updating, setUpdating] = useState(false);
  // How the parcel comes back, chosen as the return is approved or changed
  // afterwards — see lib/returns/return-shipping.ts.
  const [shippingMethod, setShippingMethod] =
    useState<ReturnMethod>("customer_ships");
  const [returnToOptions, setReturnToOptions] = useState<ReturnToOptions | null>(
    null,
  );
  const [returnToLocationId, setReturnToLocationId] = useState("");
  const [labelLink, setLabelLink] = useState("");
  const [labelFileName, setLabelFileName] = useState("");
  const [labelUploading, setLabelUploading] = useState(false);
  // Why the store is declining, for its own records. The shopper is told in
  // the message, which they are always sent.
  const [declineReason, setDeclineReason] = useState<ReturnDeclineReason>("other");
  // Where a restock puts the goods: one of the return owner's locations.
  const [restockLocations, setRestockLocations] = useState<ReturnToOptions | null>(
    null,
  );
  const [restockLocationId, setRestockLocationId] = useState("");
  // The fees and delivery an admin sets by hand, and how far each may go.
  const [refundOptions, setRefundOptions] = useState<ReturnRefundOptions | null>(null);
  // The return being exchanged (R7), and whether approving one goes straight on
  // to choosing what it is exchanged for.
  const [exchangeFor, setExchangeFor] = useState<AdminReturnRequest | null>(null);
  const [exchangeOnApprove, setExchangeOnApprove] = useState(false);
  const [restockingFeeInput, setRestockingFeeInput] = useState("");
  const [returnShippingFeeInput, setReturnShippingFeeInput] = useState("");
  const [deliveryInput, setDeliveryInput] = useState("");

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/${scope}/returns?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setReturns(data.data?.data || []);
        setTotal(Number(data.data?.pagination?.total || 0));
        setTotalPages(Math.max(1, Number(data.data?.pagination?.totalPages || 1)));
      } else {
        toast.error(data.message || data.error || "Failed to load returns");
      }
    } catch {
      toast.error("Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [scope, search, statusFilter, page, pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReturns();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchReturns]);

  const updateReturn = async (
    id: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/${scope}/returns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        if (data.data?.partialRefund) {
          // Part of a refund over two charges went; that part is on the
          // return, and only the rest needs sending again.
          toast.warning(
            data.data.partialRefund.message ||
              "Only part of this refund went through. Refund the rest again.",
          );
        } else if (data.data?.restockFailed) {
          // Everything else was saved; only the stock did not move, and the
          // restock can simply be tried again.
          toast.warning(
            "Return updated, but the items could not be put back in stock. Try \"Put back in stock\" again.",
          );
        } else {
          toast.success("Return updated");
        }
        setReturns((current) =>
          current.map((item) => (item._id === id ? data.data : item)),
        );
        setActionReturn(null);
        setActionType(null);
        setNote("");
        setRefundAmount("");
        return true;
      }
      toast.error(data?.message || data?.error || "Failed to update return");
      return false;
    } catch {
      toast.error("Failed to update return");
      return false;
    } finally {
      setUpdating(false);
    }
  };

  /**
   * What a return can still put back on the shelf, line by line — nothing
   * when its goods never came back (`returnGoodsBack`).
   */
  const restockPlanFor = (request: AdminReturnRequest) =>
    returnGoodsBack(request)
      ? returnRestockPlan(request.items, {
          itemsCounted: Boolean(request.itemsCountedAt),
          inventoryRestored: request.inventoryRestored,
        })
      : [];

  /**
   * Where a restock can put the goods — the owner's locations, the ones the
   * return's address comes from. The place the parcel was sent back to by
   * default, else where it would be sent.
   */
  const loadRestockLocations = async (request: AdminReturnRequest) => {
    setRestockLocations(null);
    setRestockLocationId("");
    try {
      const res = await fetch(`/api/${scope}/returns/${request._id}/return-to`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "");
      const options = data.data as ReturnToOptions;
      setRestockLocations(options);
      const sentTo = request.returnTo?.locationId ? String(request.returnTo.locationId) : "";
      setRestockLocationId(
        sentTo && options.locations.some((location) => location._id === sentTo)
          ? sentTo
          : options.defaultLocationId || "",
      );
    } catch (error) {
      // Put back where each line was sold from instead.
      setRestockLocations({ locations: [], defaultLocationId: null, fallback: null });
      toast.error(
        (error instanceof Error && error.message) ||
          "Could not load where the items can go back in stock",
      );
    }
  };

  /** How far an admin may take this return's fees and delivery. */
  const loadRefundOptions = async (request: AdminReturnRequest) => {
    setRefundOptions(null);
    if (!mayMoveMoney) return;
    try {
      const res = await fetch(`/api/admin/returns/${request._id}/refund-options`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "");
      setRefundOptions(data.data as ReturnRefundOptions);
    } catch (error) {
      toast.error(
        (error instanceof Error && error.message) || "Could not load this return's fees",
      );
    }
  };

  /** The fee and delivery fields, filled from the return as it is priced. */
  const resetPriceInputs = (request: AdminReturnRequest) => {
    const estimate = request.estimatedRefund;
    setRestockingFeeInput(String(Number(estimate?.restockingFee || 0)));
    setReturnShippingFeeInput(String(Number(estimate?.returnShippingFee || 0)));
    setDeliveryInput(String(Number(estimate?.shipping || 0)));
    void loadRefundOptions(request);
  };

  /** The fees and delivery an admin changed, as the update route takes them. */
  const pricePayload = (
    request: AdminReturnRequest,
    withDelivery: boolean,
  ): Record<string, unknown> => {
    if (!mayMoveMoney) return {};
    const estimate = request.estimatedRefund;
    const changed = (typed: number, was: unknown) => Math.abs(typed - Number(was || 0)) > 0.0001;
    const restockingFee = typedMoney(restockingFeeInput, Number(estimate?.restockingFee || 0));
    const returnShippingFee = typedMoney(
      returnShippingFeeInput,
      Number(estimate?.returnShippingFee || 0),
    );
    const feeOverride: Record<string, number> = {};
    if (changed(restockingFee, estimate?.restockingFee)) {
      feeOverride.restockingFee = restockingFee;
    }
    if (changed(returnShippingFee, estimate?.returnShippingFee)) {
      feeOverride.returnShippingFee = returnShippingFee;
    }
    const payload: Record<string, unknown> = {};
    if (Object.keys(feeOverride).length > 0) payload.feeOverride = feeOverride;
    if (withDelivery) {
      const delivery = typedMoney(deliveryInput, Number(estimate?.shipping || 0));
      if (changed(delivery, estimate?.shipping)) payload.deliveryRefund = delivery;
    }
    return payload;
  };

  /**
   * What is left to send once the fees and delivery are as typed — the
   * refund amount follows them, and the server re-prices the same way.
   */
  const remainingWithPrices = (
    request: AdminReturnRequest,
    typed: { delivery: string; restockingFee: string; returnShippingFee: string },
  ) => {
    const estimate = request.estimatedRefund;
    const total =
      Number(estimate?.total || 0) +
      (typedMoney(typed.delivery, Number(estimate?.shipping || 0)) -
        Number(estimate?.shipping || 0)) +
      (Number(estimate?.restockingFee || 0) -
        typedMoney(typed.restockingFee, Number(estimate?.restockingFee || 0))) +
      (Number(estimate?.returnShippingFee || 0) -
        typedMoney(typed.returnShippingFee, Number(estimate?.returnShippingFee || 0)));
    return Math.max(
      0,
      quantizeToCurrency(
        Math.max(0, total) - Number(request.actualRefund?.amount || 0),
        estimate?.currency || "USD",
      ),
    );
  };

  /** A fee or the delivery typed in — the refund amount follows it. */
  const typePrice = (
    field: "delivery" | "restockingFee" | "returnShippingFee",
    value: string,
  ) => {
    const typed = {
      delivery: deliveryInput,
      restockingFee: restockingFeeInput,
      returnShippingFee: returnShippingFeeInput,
      [field]: value,
    };
    if (field === "delivery") setDeliveryInput(value);
    if (field === "restockingFee") setRestockingFeeInput(value);
    if (field === "returnShippingFee") setReturnShippingFeeInput(value);
    if (actionType === "refund" && actionReturn) {
      const remaining = remainingWithPrices(actionReturn, typed);
      setRefundAmount(remaining > 0 ? String(remaining) : "");
    }
  };

  const openRestockDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("restock");
    setNote("");
    void loadRestockLocations(request);
  };

  const openRefundDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("refund");
    resetPriceInputs(request);
    // What is left to send: a return refunded in part is offered the rest,
    // not its whole value again — which the server would refuse.
    const remaining = Math.max(
      0,
      Number(request.estimatedRefund?.total || 0) -
        Number(request.actualRefund?.amount || 0),
    );
    setRefundAmount(
      remaining > 0
        ? String(
            quantizeToCurrency(remaining, request.estimatedRefund?.currency || "USD"),
          )
        : "",
    );
    // Nothing to put back twice: the server refuses it anyway, and offering it
    // reads as though the stock had not been restored. Ticked only once the
    // parcel is back.
    const restockable = restockPlanFor(request).length > 0;
    setRestockOnRefund(restockable && returnHasArrived(request));
    if (restockable) void loadRestockLocations(request);
    setRefundTo("original");
    setCreditInput("");
    setNote("");
  };

  /** The part of the refund typed as store credit, never more than the refund. */
  const refundCreditAmount = () => {
    if (refundTo !== "store_credit" || !refundOptions?.storeCredit?.available) return 0;
    const whole = Math.max(0, Number(refundAmount) || 0);
    return Math.min(whole, typedMoney(creditInput, whole));
  };

  /**
   * Recording what came back, rather than only that something did.
   *
   * "Mark received" set a date and nothing else: every `quantityReceived`
   * stayed at 0, the return was never counted, and the refund cap went on
   * standing for everything the shopper asked to send — so one of three units
   * arriving was still refunded as three. Every part of the count existed
   * server-side and no screen had ever sent it.
   */
  const openReceiveDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("receive");
    setCountedItems(
      Object.fromEntries(
        request.items.map((item) => [
          item.orderItemIndex,
          {
            // Everything arriving is the ordinary case; the admin corrects the
            // line that did not. A line approved down to nothing is expected
            // at nothing — offered as fully arrived, one save restocked goods
            // the store had declined to take back.
            quantity: String(
              item.quantityReceived ||
                (item.quantityApproved ?? item.quantityRequested ?? 0),
            ),
            condition: item.condition || "new",
          },
        ]),
      ),
    );
    setNote("");
  };

  const openApproveDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("approve");
    setExchangeOnApprove(false);
    setApprovedItems(
      Object.fromEntries(
        request.items.map((item) => [
          item.orderItemIndex,
          String(item.quantityApproved ?? item.quantityRequested ?? 0),
        ]),
      ),
    );
    setNote("");
    resetShipping(request);
    resetPriceInputs(request);
  };

  /** Where this return's parcel may go, for the dialog's "Return to" list. */
  const loadReturnToOptions = async (request: AdminReturnRequest) => {
    setReturnToOptions(null);
    try {
      const res = await fetch(`/api/${scope}/returns/${request._id}/return-to`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "");
      const options = data.data as ReturnToOptions;
      setReturnToOptions(options);
      const current = request.returnTo?.locationId
        ? String(request.returnTo.locationId)
        : "";
      setReturnToLocationId(
        current && options.locations.some((location) => location._id === current)
          ? current
          : options.defaultLocationId || "",
      );
    } catch (error) {
      toast.error(
        (error instanceof Error && error.message) ||
          "Could not load where this return can be sent",
      );
    }
  };

  const resetShipping = (request: AdminReturnRequest) => {
    setShippingMethod(returnMethodOf(request.returnMethod));
    setLabelLink(request.shipment?.labelUrl || "");
    setLabelFileName(
      request.shipment?.labelFileName ||
        (request.shipment?.labelFileKey ? "Uploaded label" : ""),
    );
    setReturnToLocationId("");
    void loadReturnToOptions(request);
  };

  // Changing how an approved return comes back: a label added later, or
  // another address.
  const openShippingDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("shipping");
    setNote("");
    resetShipping(request);
  };

  /** Uploaded at once, so approving can check the label is really there. */
  const uploadLabel = async (file: File) => {
    if (!actionReturn) return;
    setLabelUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/${scope}/returns/${actionReturn._id}/label`,
        { method: "POST", body: form },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "");
      setLabelFileName(data.data?.labelFileName || file.name);
      toast.success("Label uploaded");
    } catch (error) {
      toast.error(
        (error instanceof Error && error.message) || "Could not upload the label",
      );
    } finally {
      setLabelUploading(false);
    }
  };

  /** What the dialog says about how the parcel comes back, or why it cannot. */
  const shippingPayload = (): Record<string, unknown> | null => {
    if (shippingMethod === "label" && !labelFileName && !labelLink.trim()) {
      toast.error("Upload the return label, or give its link, first");
      return null;
    }
    return {
      returnMethod: shippingMethod,
      ...(shippingMethod !== "no_shipping" && returnToLocationId
        ? { returnToLocationId }
        : {}),
      ...(shippingMethod === "label" ? { labelUrl: labelLink.trim() } : {}),
    };
  };

  /**
   * The policy's two fees, each only ever lowered or waived — shown only when
   * the policy charges one on this return.
   */
  const renderFeeFields = () => {
    if (!mayMoveMoney || !refundOptions) return null;
    const { restockingFee, returnShippingFee } = refundOptions.fees;
    if (restockingFee.policy <= 0 && returnShippingFee.policy <= 0) return null;
    const currency = refundOptions.currency;
    const step = currencyPriceScale(currency) === 0 ? "1" : "0.01";
    const fields = [
      {
        key: "restockingFee" as const,
        label: "Restocking fee",
        policy: restockingFee.policy,
        value: restockingFeeInput,
      },
      {
        key: "returnShippingFee" as const,
        label: "Return shipping fee",
        policy: returnShippingFee.policy,
        value: returnShippingFeeInput,
      },
    ].filter((field) => field.policy > 0);
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={`fee-${field.key}`}>{field.label}</Label>
            <Input
              id={`fee-${field.key}`}
              type="number"
              min={0}
              max={field.policy}
              step={step}
              value={field.value}
              onChange={(event) => typePrice(field.key, event.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Up to {formatReturnMoney(field.policy, currency)}. 0 waives it.
            </span>
          </div>
        ))}
      </div>
    );
  };

  /**
   * Delivery handed back with the refund — up to what the parcel charged and
   * no refund has returned, the part the policy keeps back included (D1).
   */
  const renderDeliveryField = () => {
    if (!mayMoveMoney || !refundOptions || !actionReturn) return null;
    const { delivery } = refundOptions;
    const quoted = Number(actionReturn.estimatedRefund?.shipping || 0);
    if (delivery.max <= 0 && quoted <= 0) return null;
    const currency = refundOptions.currency;
    const typed = typedMoney(deliveryInput, quoted);
    return (
      <div className="grid gap-1.5">
        <Label htmlFor="refund-delivery">Refund delivery</Label>
        <Input
          id="refund-delivery"
          type="number"
          min={0}
          max={delivery.max}
          step={currencyPriceScale(currency) === 0 ? "1" : "0.01"}
          value={deliveryInput}
          onChange={(event) => typePrice("delivery", event.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {typed > delivery.policy + 0.0001
            ? "The carrier was paid when the parcel left, so this part comes out of your own money."
            : `Up to ${formatReturnMoney(delivery.max, currency)} of this parcel's delivery is left.`}
        </span>
      </div>
    );
  };

  /** Where a restock puts the goods — shown when the owner has locations. */
  const renderRestockLocation = () => {
    if (!restockLocations || restockLocations.locations.length === 0) return null;
    return (
      <div className="grid gap-1.5">
        <Label htmlFor="restock-at">Restock at</Label>
        <Select value={restockLocationId} onValueChange={setRestockLocationId}>
          <SelectTrigger id="restock-at" className={SELECT_TRUNCATE}>
            <SelectValue placeholder="Choose a location" />
          </SelectTrigger>
          <SelectContent position="popper" className={SELECT_LIST}>
            {restockLocations.locations.map((location) => (
              <SelectItem key={location._id} value={location._id}>
                {location.name || describeReturnDestination(location)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  /**
   * Where the refund goes (R8): back the way the shopper paid, or onto their
   * account as store credit — all of it, or the part typed, the rest going
   * back as usual. Offered only where credit can be given.
   */
  const renderRefundTo = () => {
    if (!refundOptions?.storeCredit?.available) return null;
    const currency = actionReturn?.estimatedRefund?.currency || "USD";
    const whole = Math.max(0, Number(refundAmount) || 0);
    const rest = Math.max(0, whole - refundCreditAmount());
    return (
      <div className="grid gap-3">
        <span className="text-sm font-medium">Refund to</span>
        <div role="radiogroup" className="divide-y rounded-md border">
          {REFUND_TO_CHOICES.map((choice) => {
            const selected = refundTo === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setRefundTo(choice.key)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-primary" : "border-muted-foreground/40"
                  }`}
                >
                  {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{choice.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {choice.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {refundTo === "store_credit" ? (
          <div className="grid gap-2">
            <Label htmlFor="refund-credit">Store credit</Label>
            <Input
              id="refund-credit"
              type="number"
              min={0}
              step={currencyPriceScale(currency) === 0 ? "1" : "0.01"}
              value={creditInput}
              placeholder={refundAmount}
              onChange={(event) => setCreditInput(event.target.value)}
            />
            {rest > 0.0001 ? (
              <p className="text-xs text-muted-foreground">
                The other {formatReturnMoney(rest, currency)} goes back to the original payment.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  /**
   * How the parcel comes back — shared by the approve and change dialogs. The
   * change dialog is titled with it already, so it leaves the heading off.
   */
  const renderShippingFields = ({ heading = true }: { heading?: boolean } = {}) => (
    <div className="grid gap-3">
      {heading ? <span className="text-sm font-medium">How it comes back</span> : null}
      {/* One list with hairline rows rather than a card per choice. */}
      <div role="radiogroup" className="divide-y rounded-md border">
        {RETURN_METHOD_CHOICES.map((choice) => {
          const selected = shippingMethod === choice.key;
          return (
            <button
              key={choice.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setShippingMethod(choice.key)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{choice.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {choice.detail}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {shippingMethod !== "no_shipping" ? (
        <div className="grid gap-2">
          <Label htmlFor="return-to">Return to</Label>
          {!returnToOptions ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : returnToOptions.locations.length > 0 ? (
            <Select value={returnToLocationId} onValueChange={setReturnToLocationId}>
              <SelectTrigger id="return-to" className={SELECT_TRUNCATE}>
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent position="popper" className={SELECT_LIST}>
                {/* The name is what is chosen and what the field shows; the
                    address sits under it in the list. */}
                {returnToOptions.locations.map((location) => (
                  <SelectItem
                    key={location._id}
                    value={location._id}
                    description={location.name ? location.address || undefined : undefined}
                  >
                    {location.name || describeReturnDestination(location)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              {returnToOptions.fallback
                ? describeReturnDestination(returnToOptions.fallback)
                : "No location or shipping origin is set yet. Add a location under Locations to give the shopper an address."}
            </p>
          )}
        </div>
      ) : null}
      {shippingMethod === "label" ? (
        <div className="grid gap-2">
          <Label htmlFor="return-label-file">Return label</Label>
          <Input
            id="return-label-file"
            type="file"
            accept={RETURN_LABEL_ACCEPT}
            disabled={labelUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadLabel(file);
              event.target.value = "";
            }}
          />
          <span className="text-xs text-muted-foreground">
            {labelUploading
              ? "Uploading…"
              : labelFileName
                ? `On this return: ${labelFileName}`
                : "PDF, PNG or JPG, up to 10 MB."}
          </span>
          <Label htmlFor="return-label-link" className="mt-1">
            Or a link to the label
          </Label>
          <Input
            id="return-label-link"
            type="url"
            placeholder="https://"
            value={labelLink}
            onChange={(event) => setLabelLink(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );

  /**
   * The parcel's journey back, which only the API could record until now: the
   * carrier and the tracking number a shopper sends after posting it.
   */
  const openTrackingDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("tracking");
    setTrackingCarrier(request.shipment?.carrier || "");
    setTrackingNumber(request.shipment?.trackingNumber || "");
    setNote("");
  };

  const openRejectDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("reject");
    setDeclineReason("other");
    setNote("");
  };

  /**
   * Choosing why fills in what the shopper is told — unless the store has
   * already written its own words, which are kept.
   */
  const chooseDeclineReason = (next: ReturnDeclineReason) => {
    const written = note.trim();
    if (!written || written === RETURN_DECLINE_MESSAGES[declineReason]) {
      setNote(RETURN_DECLINE_MESSAGES[next]);
    }
    setDeclineReason(next);
  };

  // An approved return the shopper never sends back holds its units for good
  // — nothing else let the store call it off.
  const openCancelDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("cancel");
    setNote("");
  };

  // Finishing a return without sending money — the one the order's own
  // refund already paid for. The API has always taken "closed", and its own
  // refusal says "close it"; no screen offered the way to.
  const openCloseDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("close");
    setNote("");
  };

  // Recording that a refund no gateway could carry has actually been sent.
  // Without this a return stays on `manual_required` for good, and nothing in
  // the system can say whether the shopper was ever paid.
  // Recording what was found on inspection, which re-prices the return.
  const openFaultDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("fault");
    setFaultChoice(
      request.faultOverride?.merchantAtFault === false ? "customer" : "merchant",
    );
    setNote("");
  };

  const openSettleDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("settle");
    setSettlementReference("");
    setNote("");
  };

  /**
   * What a row's menu offers, split so it stays short: the next steps in the
   * return's life on top, and the corrections and rarer ones under "More".
   */
  const rowActions = (request: AdminReturnRequest) => {
    const next: RowAction[] = [];
    const more: RowAction[] = [];
    if (request.status === "requested") {
      next.push(
        {
          key: "approve",
          label: "Approve request",
          icon: CheckCircle2,
          onSelect: () => openApproveDialog(request),
        },
        {
          key: "reject",
          label: "Reject request",
          icon: XCircle,
          destructive: true,
          onSelect: () => openRejectDialog(request),
        },
      );
    }
    if (["approved", "awaiting_shipment", "in_transit"].includes(request.status)) {
      next.push({
        key: "tracking",
        label: request.shipment?.trackingNumber ? "Edit tracking" : "Add tracking",
        icon: Truck,
        onSelect: () => openTrackingDialog(request),
      });
    }
    if (
      ["approved", "in_transit", "received", "inspected", "partially_refunded"].includes(
        request.status,
      )
    ) {
      next.push({
        key: "receive",
        label: "Record what came back",
        icon: ClipboardCheck,
        onSelect: () => openReceiveDialog(request),
      });
    }
    // The goods are on the shelf as soon as they are unpacked, which is
    // rarely when the money goes. Open to the vendor as well: they are the
    // ones holding the parcel, and this moves no money.
    if (returnMayRestock(request.status) && restockPlanFor(request).length > 0) {
      next.push({
        key: "restock",
        label: "Put back in stock",
        icon: PackagePlus,
        onSelect: () => openRestockDialog(request),
      });
    }
    // Refunds are the admin's alone — the money sits on the platform's
    // gateway, so a vendor issuing one would be spending someone else's
    // balance. The API refuses it either way; hiding the control keeps the
    // vendor from being offered an action that can only fail.
    // Partly refunded included: the rest of what it is worth can still be
    // owed, and nothing else ever offered a way to send it.
    if (
      mayMoveMoney &&
      ["approved", "received", "inspected", "refund_pending", "partially_refunded"].includes(
        request.status,
      ) &&
      Number(request.estimatedRefund?.total || 0) - Number(request.actualRefund?.amount || 0) >
        0.01
    ) {
      next.push({
        key: "refund",
        label: "Issue refund",
        icon: RefreshCcw,
        onSelect: () => openRefundDialog(request),
      });
    }
    // Something else instead of the money (R7): chosen any time before the
    // return is processed, and made then.
    if (mayMoveMoney && returnMayExchange(request)) {
      next.push({
        key: "exchange",
        label:
          (request.exchangeItems?.length || 0) > 0 ? "Exchange" : "Exchange for other items",
        icon: ArrowLeftRight,
        onSelect: () => setExchangeFor(request),
      });
    }
    // A refund the shopper is still owed: no gateway carried it, so somebody
    // has to send the money and say so here.
    if (
      request.refundStatus === "manual_required" &&
      (mayMoveMoney || (scope === "vendor" && request.refundPayer === "vendor"))
    ) {
      next.push({
        key: "settle",
        label: "Record refund payment",
        icon: Banknote,
        onSelect: () => openSettleDialog(request),
      });
    }

    if ((RETURN_METHOD_CHANGEABLE_STATUSES as readonly string[]).includes(request.status)) {
      more.push({
        key: "shipping",
        label: "How it comes back",
        icon: MapPin,
        onSelect: () => openShippingDialog(request),
      });
    }
    if (request.shipment?.labelFileKey || request.shipment?.labelUrl) {
      more.push({
        key: "label",
        label: "View return label",
        icon: FileText,
        href: request.shipment?.labelFileKey
          ? `/api/${scope}/returns/${request._id}/label`
          : String(request.shipment?.labelUrl),
      });
    }
    // Only before any money moves — afterwards the API refuses, because
    // re-pricing a return underneath a refund already issued could put its
    // cap below what was paid.
    if (
      mayMoveMoney &&
      !request.actualRefund?.amount &&
      [
        "requested",
        "approved",
        "in_transit",
        "received",
        "inspected",
        "refund_pending",
      ].includes(request.status)
    ) {
      more.push({
        key: "fault",
        label: "Who is at fault",
        icon: Scale,
        onSelect: () => openFaultDialog(request),
      });
    }
    // The admin's alone: a vendor cannot set a return's final state. Not while
    // its own refund is on the way, which closing would hide.
    if (
      scope === "admin" &&
      [
        "requested",
        "approved",
        "awaiting_shipment",
        "in_transit",
        "received",
        "inspected",
        "refund_pending",
        "partially_refunded",
      ].includes(request.status) &&
      !["processing", "manual_required"].includes(String(request.refundStatus || ""))
    ) {
      more.push({
        key: "close",
        label: "Close return",
        icon: Archive,
        onSelect: () => openCloseDialog(request),
      });
    }
    if (
      ["approved", "awaiting_shipment"].includes(request.status) &&
      !request.actualRefund?.amount
    ) {
      more.push({
        key: "cancel",
        label: "Cancel return",
        icon: XCircle,
        destructive: true,
        onSelect: () => openCancelDialog(request),
      });
    }
    return { next, more };
  };

  const renderRowAction = (action: RowAction) => {
    const Icon = action.icon;
    if ("href" in action) {
      return (
        <DropdownMenuItem key={action.key} asChild>
          <a href={action.href} target="_blank" rel="noopener noreferrer">
            <Icon className="h-4 w-4" />
            {action.label}
          </a>
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem
        key={action.key}
        onClick={action.onSelect}
        disabled={updating}
        variant={action.destructive ? "destructive" : "default"}
      >
        <Icon className="h-4 w-4" />
        {action.label}
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Return requests</CardTitle>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full capitalize sm:w-48" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETURN_STATUS_FILTERS.map((status) => (
                  <SelectItem key={status} value={status} className="capitalize">
                    {status === "all" ? "All statuses" : status.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search return or order number"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Refund</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center">
                      Loading returns...
                    </TableCell>
                  </TableRow>
                ) : returns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center">
                      No return requests found.
                    </TableCell>
                  </TableRow>
                ) : (
                  returns.map((request) => (
                    <TableRow key={request._id}>
                      <TableCell>
                        <p className="font-medium">{request.returnNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(request.createdAt).toLocaleDateString()}
                        </p>
                        {scope === "admin" && ownerLabel(request) ? (
                          <Badge variant="outline" className="mt-1 w-fit font-normal">
                            {ownerLabel(request)}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/${scope}/orders/${request.orderId}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {request.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p>
                          {request.posWalkIn
                            ? t("admin.orderDetails.walkInCustomer")
                            : request.customerId?.name || "Customer"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {request.customerId?.email}
                        </p>
                      </TableCell>
                      <TableCell className="min-w-64">
                        {request.items
                          .map((item) => `${item.name} x${item.quantityRequested}`)
                          .join(", ")}
                      </TableCell>
                      <TableCell>
                        {formatReturnMoney(
                          request.estimatedRefund?.total || 0,
                          request.estimatedRefund?.currency,
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusVariant(request.status)} className="w-fit capitalize">
                            {request.status.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize">
                            {request.refundStatus.replace(/_/g, " ")}
                          </span>
                          {/* What the return became, or is to become (R7). */}
                          {request.exchange?.orderId && !request.exchange.undoneAt ? (
                            <Link
                              href={`/${scope}/orders/${request.exchange.orderId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Exchange #{request.exchange.orderNumber}
                            </Link>
                          ) : (request.exchangeItems?.length || 0) > 0 &&
                            returnMayExchange(request) ? (
                            <span className="text-xs text-muted-foreground">
                              To exchange for{" "}
                              {request.exchangeItems
                                ?.map((item) => `${item.name} x${item.quantity}`)
                                .join(", ")}
                            </span>
                          ) : null}
                          {(() => {
                            // Back on the shelf in steps as the parcel arrives.
                            const progress = returnRestockProgress(request);
                            if (progress.done) {
                              return (
                                <span className="text-xs text-muted-foreground">
                                  Back in stock
                                </span>
                              );
                            }
                            return progress.restocked > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {progress.restocked} back in stock
                              </span>
                            ) : null;
                          })()}
                          {/* Why the store declined — its own record; the
                              shopper was sent the message. */}
                          {request.status === "rejected" &&
                          isReturnDeclineReason(request.declineReason) ? (
                            <span className="text-xs text-muted-foreground">
                              {RETURN_DECLINE_REASON_LABELS[request.declineReason]}
                            </span>
                          ) : null}
                          {/* How the parcel is coming back, while it still is. */}
                          {request.returnMethod &&
                          (RETURN_SHIPPING_OPEN_STATUSES as readonly string[]).includes(
                            request.status,
                          ) ? (
                            <span className="text-xs text-muted-foreground">
                              {request.shipment?.trackingAddedBy === "customer"
                                ? "Tracking from the shopper"
                                : RETURN_METHOD_NOTES[returnMethodOf(request.returnMethod)]}
                            </span>
                          ) : null}
                          {/* A Pesapal refund goes only once Pesapal approves it;
                              recording that on Payments settles this too. */}
                          {request.refundStatus === "processing" ? (
                            <span className="text-xs text-muted-foreground">
                              {scope === "vendor"
                                ? "Waiting on the payment provider"
                                : "Waiting on the provider — record it under Payments once it has gone"}
                            </span>
                          ) : null}
                          {request.refundPayer === "vendor" &&
                          request.refundStatus !== "not_required" ? (
                            <span className="text-xs text-muted-foreground">
                              {scope === "vendor"
                                ? "You send this refund"
                                : "The seller sends this refund"}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Open actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem asChild>
                                <Link href={`/${scope}/orders/${request.orderId}`}>
                                  <Eye className="h-4 w-4" />
                                  View order
                                </Link>
                              </DropdownMenuItem>
                              {(() => {
                                const { next, more } = rowActions(request);
                                return (
                                  <>
                                    {next.length > 0 ? <DropdownMenuSeparator /> : null}
                                    {next.map(renderRowAction)}
                                    {more.length > 0 ? <DropdownMenuSeparator /> : null}
                                    {/* One rarer action needs no submenu of its own. */}
                                    {more.length === 1 ? (
                                      renderRowAction(more[0])
                                    ) : more.length > 1 ? (
                                      <DropdownMenuSub>
                                        <DropdownMenuSubTrigger disabled={updating}>
                                          <CircleEllipsis className="h-4 w-4" />
                                          More
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent className="w-52">
                                          {more.map(renderRowAction)}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuSub>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4">
            <DataTablePagination
              pagination={{ page, pageSize, total, totalPages }}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(actionReturn && actionType)}
        onOpenChange={(open) => {
          if (!open) {
            setActionReturn(null);
            setActionType(null);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] grid-cols-1 overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle>
              {actionType === "refund"
                ? "Issue refund"
                : actionType === "settle"
                  ? "Record refund payment"
                  : actionType === "fault"
                    ? "Who is at fault?"
                    : actionType === "receive"
                      ? "Record what came back"
                      : actionType === "approve"
                        ? "Approve this return"
                        : actionType === "tracking"
                          ? "Return tracking"
                          : actionType === "shipping"
                          ? "How it comes back"
                          : actionType === "restock"
                          ? "Put back in stock"
                          : actionType === "cancel"
                            ? "Cancel this return"
                            : actionType === "close"
                              ? "Close this return"
                              : "Reject return"}
            </DialogTitle>
            <DialogDescription>
              {actionReturn?.returnNumber} for order {actionReturn?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          {actionType === "refund" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              {/* Set to be exchanged (R7): the exchange order is made from
                  its own dialog, and what it leaves over is refunded here. */}
              {actionReturn &&
              (actionReturn.exchangeItems?.length || 0) > 0 &&
              !(actionReturn.exchange?.orderId && !actionReturn.exchange.undoneAt) ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <span className="text-muted-foreground">
                    This return is set to be exchanged for other items.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const request = actionReturn;
                      setActionReturn(null);
                      setActionType(null);
                      setExchangeFor(request);
                    }}
                  >
                    Exchange instead
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="refund-amount">Refund amount</Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min={0}
                  // Whole units in a currency that has no smaller ones.
                  step={
                    currencyPriceScale(actionReturn?.estimatedRefund?.currency || "USD") === 0
                      ? "1"
                      : "0.01"
                  }
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                />
              </div>
              {renderRefundTo()}
              {renderDeliveryField()}
              {renderFeeFields()}
              {/* The estimate is what the goods were WORTH, not what state they
                  arrived in — a unit that came back broken still caps at its
                  full price. Whether to hand all of it back is a judgement,
                  and it cannot be made against a figure that never mentions
                  the parcel. */}
              {actionReturn?.itemsCountedAt ? (
                <div className="rounded-md border p-3 text-sm">
                  <span className="block font-medium">What came back</span>
                  {actionReturn.items.map((item) => {
                    const expected =
                      item.quantityApproved ?? item.quantityRequested ?? 0;
                    const arrived = item.quantityReceived ?? 0;
                    const condition = item.condition
                      ? CONDITION_LABELS[item.condition] || item.condition
                      : null;
                    return (
                      <span
                        key={item.orderItemIndex}
                        className="block text-muted-foreground"
                      >
                        {item.name}: {arrived} of {expected}
                        {condition ? `, ${condition}` : ""}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              {actionReturn && restockPlanFor(actionReturn).length === 0 ? (
                returnRestockProgress(actionReturn).restocked > 0 ||
                actionReturn.inventoryRestored ? (
                  <p className="text-sm text-muted-foreground">
                    These items are already back in stock.
                  </p>
                ) : null
              ) : (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                  <Checkbox
                    checked={restockOnRefund}
                    onCheckedChange={(value) => setRestockOnRefund(value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      Put the returned items back in stock
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Only the units on this return, never the whole order.
                      Untick it if nothing sellable came back.
                    </span>
                  </span>
                </label>
              )}
              {restockOnRefund && actionReturn && restockPlanFor(actionReturn).length > 0
                ? renderRestockLocation()
                : null}
              {actionReturn?.refundDestination?.method &&
              // Nothing to send by hand when all of it is store credit.
              !(refundCreditAmount() > 0 && refundCreditAmount() >= Number(refundAmount) - 0.0001) ? (
                <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  This order was not paid by card, so the refund has to be sent
                  by hand to{" "}
                  <span className="font-medium text-foreground">
                    {describeRefundDestination(actionReturn.refundDestination)}
                  </span>
                  .{" "}
                  {actionReturn.refundPayer === "vendor"
                    ? // The seller's van collected this order's cash, so the
                      // store has none of it to send back. Issuing the refund
                      // here books it and takes the commission off what they
                      // owe; the money itself is theirs to pay.
                      "The seller collected this order's money, so it is theirs to send — issuing the refund tells them, and takes the commission on these goods off what they owe you."
                    : "Record the payment once it has gone."}
                </p>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="refund-note">Reason</Label>
                <Textarea
                  id="refund-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional refund note"
                />
              </div>
            </div>
          ) : actionType === "fault" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                The shopper gave{" "}
                <span className="font-medium text-foreground">
                  {actionReturn?.reason?.replace(/_/g, " ")}
                </span>
                . What you found decides the delivery refund and the two fees —
                the estimate is recalculated when you save.
              </p>
              <div className="grid gap-2">
                {(
                  [
                    {
                      key: "merchant" as const,
                      title: "Our failure",
                      detail:
                        "Delivery comes back, and no restocking or return shipping fee is charged.",
                    },
                    {
                      key: "customer" as const,
                      title: "The shopper's choice",
                      detail:
                        "Goods and tax come back. Delivery stays with us, and the policy's fees apply.",
                    },
                  ]
                ).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFaultChoice(option.key)}
                    aria-pressed={faultChoice === option.key}
                    className={`rounded-md border p-3 text-left text-sm transition-colors ${
                      faultChoice === option.key
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="block font-medium">{option.title}</span>
                    <span className="block text-muted-foreground">
                      {option.detail}
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fault-note">
                  What you found{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="fault-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Screen cracked on arrival, packaging intact"
                />
              </div>
            </div>
          ) : actionType === "approve" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Take back all of it, or only part. What you approve is what the
                refund is priced from.
              </p>
              <div className="grid gap-3">
                {actionReturn?.items.map((item) => (
                  <div
                    key={item.orderItemIndex}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <span className="block text-sm font-medium">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.quantityRequested} asked for
                      </span>
                    </div>
                    <div className="grid gap-1.5">
                      <Label
                        htmlFor={`approved-${item.orderItemIndex}`}
                        className="text-xs"
                      >
                        Approve
                      </Label>
                      <Input
                        id={`approved-${item.orderItemIndex}`}
                        type="number"
                        min={0}
                        max={item.quantityRequested}
                        step="1"
                        className="sm:w-24"
                        value={approvedItems[item.orderItemIndex] ?? ""}
                        onChange={(event) =>
                          setApprovedItems((current) => ({
                            ...current,
                            [item.orderItemIndex]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
              {renderFeeFields()}
              {renderShippingFields()}
              {mayMoveMoney ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={exchangeOnApprove}
                    onCheckedChange={(value) => setExchangeOnApprove(value === true)}
                  />
                  Exchange it for other items instead of a refund
                </label>
              ) : null}
            </div>
          ) : actionType === "restock" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Only what came back sellable and is not back yet. A unit that
                arrives later can be put back then.
              </p>
              <div className="divide-y rounded-md border text-sm">
                {actionReturn
                  ? restockPlanFor(actionReturn).map((line) => {
                      const item = actionReturn.items.find(
                        (candidate) => candidate.orderItemIndex === line.orderItemIndex,
                      );
                      return (
                        <div
                          key={line.orderItemIndex}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <span className="min-w-0 truncate">{item?.name || "Item"}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {line.quantity}
                            {line.restockedBefore > 0
                              ? ` more (${line.restockedBefore} already back)`
                              : ""}
                          </span>
                        </div>
                      );
                    })
                  : null}
              </div>
              {renderRestockLocation()}
            </div>
          ) : actionType === "shipping" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                The shopper is told again, with the new details.
              </p>
              {renderShippingFields({ heading: false })}
            </div>
          ) : actionType === "tracking" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Where the parcel coming back is. Saving this marks the return in
                transit.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="return-carrier">Carrier</Label>
                <Input
                  id="return-carrier"
                  value={trackingCarrier}
                  onChange={(event) => setTrackingCarrier(event.target.value)}
                  placeholder="DHL, Royal Mail, Pathao"
                  maxLength={100}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="return-tracking">Tracking number</Label>
                <Input
                  id="return-tracking"
                  value={trackingNumber}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                  placeholder="As the shopper gave it"
                  maxLength={100}
                />
              </div>
            </div>
          ) : actionType === "receive" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Count the parcel line by line. The refund is re-priced to what
                actually arrived, and damaged or unusable units are left out of
                the restock.
              </p>
              <div className="grid gap-3">
                {actionReturn?.items.map((item) => {
                  const expected =
                    item.quantityApproved ?? item.quantityRequested ?? 0;
                  const counted = countedItems[item.orderItemIndex];
                  return (
                    <div
                      key={item.orderItemIndex}
                      className="grid gap-2 rounded-md border p-3"
                    >
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {expected} expected
                      </span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label
                            htmlFor={`received-${item.orderItemIndex}`}
                            className="text-xs"
                          >
                            Arrived
                          </Label>
                          <Input
                            id={`received-${item.orderItemIndex}`}
                            type="number"
                            min={0}
                            max={expected}
                            step="1"
                            value={counted?.quantity ?? ""}
                            onChange={(event) =>
                              setCountedItems((current) => ({
                                ...current,
                                [item.orderItemIndex]: {
                                  quantity: event.target.value,
                                  condition: current[item.orderItemIndex]?.condition || "new",
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Condition</Label>
                          <Select
                            value={counted?.condition || "new"}
                            onValueChange={(value) =>
                              setCountedItems((current) => ({
                                ...current,
                                [item.orderItemIndex]: {
                                  quantity: current[item.orderItemIndex]?.quantity ?? "0",
                                  condition: value,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">Sellable</SelectItem>
                              <SelectItem value="opened">Opened</SelectItem>
                              <SelectItem value="damaged">Damaged</SelectItem>
                              <SelectItem value="missing_parts">
                                Missing parts
                              </SelectItem>
                              <SelectItem value="unusable">Unusable</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="receive-note">
                  Note <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="receive-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Box crushed on one corner"
                />
              </div>
            </div>
          ) : actionType === "settle" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
                <span className="text-muted-foreground">Send to</span>
                <span className="font-medium">
                  {describeRefundDestination(actionReturn?.refundDestination)}
                </span>
                {actionReturn?.refundDestination?.accountName ? (
                  <span className="text-muted-foreground">
                    Account holder: {actionReturn.refundDestination.accountName}
                  </span>
                ) : null}
                {/* In full, here and nowhere else: this is the one screen that
                    sends the money, and the last four digits were all it
                    ever showed — the payer had to write to the shopper again
                    to find out where to pay. */}
                {actionReturn?.refundDestination?.accountNumber ? (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">Account number:</span>
                    <span className="break-all font-mono font-medium">
                      {actionReturn.refundDestination.accountNumber}
                    </span>
                    <CopyTrackingNumber
                      value={actionReturn.refundDestination.accountNumber}
                      label="Copy account number"
                      copiedMessage="Account number copied"
                    />
                  </span>
                ) : null}
                {actionReturn?.actualRefund?.amount ? (
                  <span className="text-muted-foreground">
                    Amount owed:{" "}
                    {formatReturnMoney(
                      actionReturn.actualRefund.amount,
                      actionReturn.estimatedRefund?.currency,
                    )}
                  </span>
                ) : null}
              </div>
              {actionReturn?.refundPayer === "vendor" ? (
                <p className="text-sm text-muted-foreground">
                  {scope === "vendor"
                    ? "You collected this order's money at the door, so this refund is yours to send. Recording it here tells the shopper it has gone."
                    : "The seller collected this order's money, so this one is theirs to send. Record it here only if you know it has."}
                </p>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="settlement-reference">
                  Transfer reference{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="settlement-reference"
                  value={settlementReference}
                  onChange={(event) => setSettlementReference(event.target.value)}
                  placeholder="Bank or wallet transaction ID"
                  maxLength={200}
                />
              </div>
            </div>
          ) : actionType === "cancel" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                For a return the shopper never sent back. Its items become
                returnable again, and the shopper is told it was cancelled.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="cancel-note">
                  Reason <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="cancel-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Nothing was sent back within two weeks"
                />
              </div>
            </div>
          ) : actionType === "close" ? (
            <div className="grid grid-cols-1 gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                Finishes the return without sending any money — for when a
                refund on the order already paid for its items. They stay
                claimed, so they cannot be returned or refunded again, and
                they can still be put back in stock.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="close-note">
                  Note <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="close-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Refunded with the order"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="decline-reason">Reason</Label>
                <Select
                  value={declineReason}
                  onValueChange={(value) =>
                    isReturnDeclineReason(value) ? chooseDeclineReason(value) : undefined
                  }
                >
                  <SelectTrigger id="decline-reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_DECLINE_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {RETURN_DECLINE_REASON_LABELS[reason]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  For your records. The customer never sees it.
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reject-note">Message to the customer</Label>
                <Textarea
                  id="reject-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Explain why this return can't be accepted"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActionReturn(null);
                setActionType(null);
              }}
              disabled={updating}
            >
              Cancel
            </Button>
            <Button
              variant={
                actionType === "reject" || actionType === "cancel"
                  ? "destructive"
                  : "default"
              }
              disabled={
                updating ||
                !actionReturn ||
                // The shopper is always told why.
                (actionType === "reject" && !note.trim()) ||
                // Where the goods go is still loading.
                (actionType === "restock" && !restockLocations)
              }
              onClick={() => {
                if (!actionReturn) return;
                if (actionType === "refund") {
                  const restocking =
                    restockOnRefund && restockPlanFor(actionReturn).length > 0;
                  void updateReturn(actionReturn._id, {
                    status: "refunded",
                    refundAmount: Number(refundAmount),
                    refundReason: note.trim() || undefined,
                    ...(refundCreditAmount() > 0
                      ? { storeCreditAmount: refundCreditAmount() }
                      : {}),
                    ...pricePayload(actionReturn, true),
                    ...(restocking
                      ? {
                          restoreInventoryOnRefund: true,
                          ...(restockLocationId ? { restockLocationId } : {}),
                        }
                      : {}),
                  });
                  return;
                }
                if (actionType === "restock") {
                  void updateReturn(actionReturn._id, {
                    restoreInventoryOnRefund: true,
                    ...(restockLocationId ? { restockLocationId } : {}),
                  });
                  return;
                }
                if (actionType === "shipping") {
                  const shipping = shippingPayload();
                  if (shipping) void updateReturn(actionReturn._id, shipping);
                  return;
                }
                if (actionType === "approve") {
                  const shipping = shippingPayload();
                  if (!shipping) return;
                  const approving = actionReturn;
                  const thenExchange = exchangeOnApprove && mayMoveMoney;
                  void updateReturn(actionReturn._id, {
                    ...shipping,
                    ...pricePayload(actionReturn, false),
                    status: "approved",
                    approvedItems: actionReturn.items.map((item) => ({
                      orderItemIndex: item.orderItemIndex,
                      quantityApproved: Math.max(
                        0,
                        Math.min(
                          item.quantityRequested,
                          Number(
                            approvedItems[item.orderItemIndex] ??
                              item.quantityRequested,
                          ),
                        ),
                      ),
                    })),
                  }).then((approved) => {
                    // On to what it is exchanged for (R7).
                    if (approved && thenExchange) setExchangeFor(approving);
                  });
                  return;
                }
                if (actionType === "tracking") {
                  if (!trackingNumber.trim()) {
                    toast.error("Enter the tracking number");
                    return;
                  }
                  void updateReturn(actionReturn._id, {
                    trackingNumber: trackingNumber.trim(),
                    ...(trackingCarrier.trim()
                      ? { carrier: trackingCarrier.trim() }
                      : {}),
                  });
                  return;
                }
                if (actionType === "receive") {
                  void updateReturn(actionReturn._id, {
                    // Counted after a refund, the count is recorded and the
                    // return stays where the money left it.
                    ...(actionReturn.status === "partially_refunded"
                      ? {}
                      : { status: "received" }),
                    receivedItems: actionReturn.items.map((item) => {
                      const expected =
                        item.quantityApproved ?? item.quantityRequested ?? 0;
                      const counted = countedItems[item.orderItemIndex];
                      return {
                        orderItemIndex: item.orderItemIndex,
                        quantityReceived: Math.max(
                          0,
                          Math.min(expected, Number(counted?.quantity || 0)),
                        ),
                        condition: counted?.condition || "new",
                      };
                    }),
                    ...(note.trim() ? { adminNote: note.trim() } : {}),
                  });
                  return;
                }
                if (actionType === "fault") {
                  void updateReturn(actionReturn._id, {
                    faultOverride: {
                      merchantAtFault: faultChoice === "merchant",
                      note: note.trim() || undefined,
                    },
                  });
                  return;
                }
                if (actionType === "cancel") {
                  void updateReturn(actionReturn._id, {
                    status: "cancelled",
                    ...(note.trim() ? { rejectionReason: note.trim() } : {}),
                  });
                  return;
                }
                if (actionType === "close") {
                  void updateReturn(actionReturn._id, {
                    status: "closed",
                    ...(note.trim() ? { adminNote: note.trim() } : {}),
                  });
                  return;
                }
                if (actionType === "settle") {
                  void updateReturn(actionReturn._id, {
                    settlement: {
                      // The destination the shopper gave IS how it was paid;
                      // asking the admin to restate it invites the two
                      // disagreeing on the same return.
                      method: actionReturn.refundDestination?.method || "cash",
                      reference: settlementReference.trim() || undefined,
                    },
                  });
                  return;
                }
                void updateReturn(actionReturn._id, {
                  status: "rejected",
                  declineReason,
                  rejectionReason: note.trim(),
                });
              }}
            >
              {updating
                ? "Working..."
                : actionType === "approve"
                  ? "Approve"
                  : actionType === "shipping"
                  ? "Save"
                  : actionType === "restock"
                  ? "Put back in stock"
                  : actionType === "tracking"
                  ? "Save tracking"
                  : actionType === "receive"
                  ? "Save the count"
                  : actionType === "refund"
                  ? "Issue refund"
                  : actionType === "fault"
                    ? "Save and recalculate"
                    : actionType === "settle"
                    ? `Mark paid by ${getRefundDestinationLabel(
                        actionReturn?.refundDestination?.method || "cash",
                      ).toLowerCase()}`
                    : actionType === "cancel"
                    ? "Cancel return"
                    : actionType === "close"
                    ? "Close return"
                    : "Reject return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {exchangeFor ? (
        <ReturnExchangeDialog
          key={exchangeFor._id}
          returnRequest={exchangeFor}
          onOpenChange={(open) => {
            if (!open) setExchangeFor(null);
          }}
          restockable={
            returnHasArrived(exchangeFor) && restockPlanFor(exchangeFor).length > 0
          }
          onDone={() => {
            void fetchReturns();
          }}
        />
      ) : null}
    </>
  );
}
