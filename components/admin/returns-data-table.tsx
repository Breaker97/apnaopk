"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Eye,
  MoreHorizontal,
  RefreshCcw,
  Search,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useCurrency } from "@/providers/currency-provider";
import {
  describeRefundDestination,
  getRefundDestinationLabel,
  type RefundDestinationInput,
} from "@/lib/returns/refund-settlement";

interface AdminReturnRequest {
  _id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  customerId?: { name?: string; email?: string };
  status: string;
  refundStatus: string;
  reason: string;
  customerNote?: string;
  ownerType?: "admin" | "vendor";
  ownerVendorId?: { storeName?: string } | string | null;
  estimatedRefund: {
    total: number;
    currency: string;
  };
  actualRefund?: {
    amount?: number;
    settledMethod?: string;
    settledReference?: string;
    settledAt?: string;
  };
  /** Where a refund no gateway can carry should be sent, from the shopper. */
  refundDestination?: RefundDestinationInput;
  /** What the merchant found on inspection, when they have recorded it. */
  faultOverride?: { merchantAtFault?: boolean; note?: string };
  items: Array<{
    name: string;
    quantityRequested: number;
  }>;
  createdAt: string;
}

interface ReturnsDataTableProps {
  locale: string;
  scope?: "admin" | "vendor";
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

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "rejected" || status === "cancelled") return "destructive";
  if (status === "refunded") return "default";
  if (status === "requested" || status === "refund_pending") return "secondary";
  return "outline";
}

export function ReturnsDataTable({
  locale,
  scope = "admin",
}: ReturnsDataTableProps) {
  const { formatPrice } = useCurrency();
  const [returns, setReturns] = useState<AdminReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionReturn, setActionReturn] = useState<AdminReturnRequest | null>(null);
  const [actionType, setActionType] = useState<
    "reject" | "refund" | "settle" | "fault" | null
  >(null);
  const [faultChoice, setFaultChoice] = useState<"merchant" | "customer">(
    "merchant",
  );
  const [note, setNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/${scope}/returns?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setReturns(data.data?.data || []);
      } else {
        toast.error(data.message || data.error || "Failed to load returns");
      }
    } catch {
      toast.error("Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [scope, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReturns();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchReturns]);

  const updateReturn = async (
    id: string,
    payload: Record<string, unknown>,
  ) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/${scope}/returns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast.success("Return updated");
        setReturns((current) =>
          current.map((item) => (item._id === id ? data.data : item)),
        );
        setActionReturn(null);
        setActionType(null);
        setNote("");
        setRefundAmount("");
      } else {
        toast.error(data?.message || data?.error || "Failed to update return");
      }
    } catch {
      toast.error("Failed to update return");
    } finally {
      setUpdating(false);
    }
  };

  const openRefundDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("refund");
    setRefundAmount(String(request.estimatedRefund?.total || ""));
    setNote("");
  };

  const openRejectDialog = (request: AdminReturnRequest) => {
    setActionReturn(request);
    setActionType("reject");
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

  return (
    <>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Return requests</CardTitle>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search return or order number"
              className="pl-9"
            />
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
                          href={`/${locale}/${scope}/orders/${request.orderId}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {request.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p>{request.customerId?.name || "Customer"}</p>
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
                        {formatPrice(request.estimatedRefund?.total || 0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusVariant(request.status)} className="w-fit capitalize">
                            {request.status.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize">
                            {request.refundStatus.replace(/_/g, " ")}
                          </span>
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
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem asChild>
                                <Link href={`/${locale}/${scope}/orders/${request.orderId}`}>
                                  <Eye className="h-4 w-4" />
                                  View order
                                </Link>
                              </DropdownMenuItem>
                              {request.status === "requested" ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      void updateReturn(request._id, {
                                        status: "approved",
                                      })
                                    }
                                    disabled={updating}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    Approve request
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openRejectDialog(request)}
                                    disabled={updating}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <XCircle className="h-4 w-4" />
                                    Reject request
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              {["approved", "in_transit"].includes(request.status) ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      void updateReturn(request._id, {
                                        status: "received",
                                      })
                                    }
                                    disabled={updating}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    Mark received
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              {/* Refunds are the admin's alone — the money sits
                                  on the platform's gateway, so a vendor issuing
                                  one would be spending someone else's balance.
                                  The API refuses it either way; hiding the
                                  control keeps the vendor from being offered an
                                  action that can only fail. */}
                              {scope === "admin" &&
                              [
                                "approved",
                                "received",
                                "inspected",
                                "refund_pending",
                              ].includes(request.status) ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => openRefundDialog(request)}
                                    disabled={updating}
                                  >
                                    <RefreshCcw className="h-4 w-4" />
                                    Issue refund
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              {/* Only before any money moves — afterwards the
                                  API refuses, because re-pricing a return
                                  underneath a refund already issued could put
                                  its cap below what was paid. */}
                              {scope === "admin" &&
                              !request.actualRefund?.amount &&
                              [
                                "requested",
                                "approved",
                                "in_transit",
                                "received",
                                "inspected",
                                "refund_pending",
                              ].includes(request.status) ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => openFaultDialog(request)}
                                    disabled={updating}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    Set what it is down to
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              {/* A refund the shopper is still owed: no
                                  gateway carried it, so somebody has to send
                                  the money and say so here. */}
                              {scope === "admin" &&
                              request.refundStatus === "manual_required" ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => openSettleDialog(request)}
                                    disabled={updating}
                                  >
                                    <RefreshCcw className="h-4 w-4" />
                                    Record refund payment
                                  </DropdownMenuItem>
                                </>
                              ) : null}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "refund"
                ? "Issue refund"
                : actionType === "settle"
                  ? "Record refund payment"
                  : actionType === "fault"
                    ? "What is this return down to?"
                    : "Reject return"}
            </DialogTitle>
            <DialogDescription>
              {actionReturn?.returnNumber} for order {actionReturn?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          {actionType === "refund" ? (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="refund-amount">Refund amount</Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                />
              </div>
              {actionReturn?.refundDestination?.method ? (
                <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  This order was not paid by card, so the refund has to be sent
                  by hand to{" "}
                  <span className="font-medium text-foreground">
                    {describeRefundDestination(actionReturn.refundDestination)}
                  </span>
                  . Record the payment once it has gone.
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
            <div className="grid gap-4 py-2">
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
          ) : actionType === "settle" ? (
            <div className="grid gap-4 py-2">
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
                {actionReturn?.actualRefund?.amount ? (
                  <span className="text-muted-foreground">
                    Amount owed: {formatPrice(actionReturn.actualRefund.amount)}
                  </span>
                ) : null}
              </div>
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
          ) : (
            <div className="grid gap-2 py-2">
              <Label htmlFor="reject-note">Reason</Label>
              <Textarea
                id="reject-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Explain why this return cannot be accepted"
              />
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
              variant={actionType === "reject" ? "destructive" : "default"}
              disabled={updating || !actionReturn}
              onClick={() => {
                if (!actionReturn) return;
                if (actionType === "refund") {
                  void updateReturn(actionReturn._id, {
                    status: "refunded",
                    refundAmount: Number(refundAmount),
                    refundReason: note.trim() || undefined,
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
                  rejectionReason: note.trim() || undefined,
                });
              }}
            >
              {updating
                ? "Working..."
                : actionType === "refund"
                  ? "Issue refund"
                  : actionType === "fault"
                    ? "Save and recalculate"
                    : actionType === "settle"
                    ? `Mark paid by ${getRefundDestinationLabel(
                        actionReturn?.refundDestination?.method || "cash",
                      ).toLowerCase()}`
                    : "Reject return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
