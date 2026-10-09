"use client";

import {
  Ban,
  BadgeCheck,
  CheckCircle,
  CircleDot,
  CreditCard,
  Download,
  FileText,
  KeyRound,
  Layers,
  LockKeyhole,
  LogIn,
  LogOut,
  OctagonAlert,
  PauseCircle,
  PlusCircle,
  RotateCcw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ShoppingBag,
  SlidersHorizontal,
  UserCog,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useActivityLabels } from "@/components/admin/activity-log/activity-labels";
import { cn } from "@/lib/utils";

/**
 * How an audit action is drawn, in one place.
 *
 * The staff tab, the vendor tab and the order timeline each kept their own copy
 * of this — a badge variant map in the first two, an icon switch in the third —
 * and the Activity Log page needs all of it. An action is never shown by colour
 * alone: the badge carries an icon and its name, so a red "Sign-in failed" and a
 * red "Deleted" are told apart without seeing red.
 *
 * Keyed on the stored string and not on `AuditAction`: an action added to
 * `config/audit.config.ts` renders with the fallback until it gets a line here,
 * rather than failing to compile or drawing nothing.
 */

type BadgeVariant = "default" | "outline" | "secondary" | "destructive";

interface ActionStyle {
  icon: LucideIcon;
  variant: BadgeVariant;
  /** Text colour for the bare icon (the timeline), where there is no badge. */
  tone: string;
  /** Extra classes for the badge, where its variant is not the colour wanted. */
  badgeClassName?: string;
}

const MUTED = "text-muted-foreground";

const ACTION_STYLES: Record<string, ActionStyle> = {
  CREATE: { icon: PlusCircle, variant: "default", tone: "text-blue-500" },
  UPDATE: { icon: FileText, variant: "secondary", tone: "text-orange-500" },
  DELETE: { icon: XCircle, variant: "destructive", tone: "text-red-500" },
  LOGIN: { icon: LogIn, variant: "outline", tone: MUTED },
  LOGOUT: { icon: LogOut, variant: "outline", tone: MUTED },
  LOGIN_FAILED: { icon: ShieldX, variant: "destructive", tone: "text-red-500" },
  PASSWORD_CHANGE: { icon: KeyRound, variant: "secondary", tone: "text-orange-500" },
  PASSWORD_RESET: { icon: LockKeyhole, variant: "secondary", tone: "text-orange-500" },
  TWO_FACTOR_CHANGE: { icon: ShieldCheck, variant: "secondary", tone: "text-orange-500" },
  SETTINGS_CHANGE: { icon: SlidersHorizontal, variant: "secondary", tone: "text-orange-500" },
  STATUS_CHANGE: { icon: CheckCircle, variant: "secondary", tone: "text-green-500" },
  // Amber, and deliberately not the green check a normal transition gets:
  // someone stepped outside the workflow here, and the row should say so at a
  // glance rather than blend into the ones that followed the rules.
  STATUS_OVERRIDE: {
    icon: ShieldAlert,
    variant: "outline",
    tone: "text-amber-500",
    badgeClassName:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  ROLE_CHANGE: { icon: UserCog, variant: "secondary", tone: "text-orange-500" },
  PERMISSION_CHANGE: { icon: Shield, variant: "secondary", tone: "text-orange-500" },
  APPROVAL: { icon: BadgeCheck, variant: "default", tone: "text-green-500" },
  REJECTION: { icon: Ban, variant: "destructive", tone: "text-red-500" },
  SUSPENSION: { icon: PauseCircle, variant: "destructive", tone: "text-red-500" },
  PAYMENT: { icon: CreditCard, variant: "default", tone: "text-green-600" },
  REFUND: { icon: RotateCcw, variant: "destructive", tone: "text-red-500" },
  EXPORT: { icon: Download, variant: "outline", tone: MUTED },
  BULK_ACTION: { icon: Layers, variant: "secondary", tone: "text-orange-500" },
  INVITE_SENT: { icon: Send, variant: "secondary", tone: "text-blue-500" },
};

const FALLBACK_STYLE: ActionStyle = {
  icon: CircleDot,
  variant: "outline",
  tone: MUTED,
};

function styleOf(action: string | undefined): ActionStyle {
  return (action && ACTION_STYLES[action]) || FALLBACK_STYLE;
}

/** The badge variant an action wears. */
export function actionBadgeVariant(action: string | undefined): BadgeVariant {
  return styleOf(action).variant;
}

interface ActionIconOptions {
  /**
   * The status a status-change row ended on. A cancellation is a STATUS_CHANGE
   * like any other, so it would otherwise get the same green check as "shipped".
   */
  status?: string;
  /** What the row is about: a created *order* is a bag, any other record a plus. */
  resource?: string;
  /** No size and no colour of its own: the caller (a badge) sets both. */
  plain?: boolean;
  className?: string;
}

function iconFor(action: string | undefined, options: ActionIconOptions): LucideIcon {
  if (options.status === "cancelled") return XCircle;
  if (action === "CREATE" && options.resource === "order") return ShoppingBag;
  return styleOf(action).icon;
}

/**
 * The bare icon for an action, sized for a timeline line. One icon per event
 * class: money moving (payment green, refund red) has to be distinguishable at a
 * glance from an ordinary field edit.
 */
export function getActionIcon(action?: string, options: ActionIconOptions = {}) {
  const Icon = iconFor(action, options);
  const tone = options.status === "cancelled" ? "text-red-500" : styleOf(action).tone;
  return (
    <Icon
      aria-hidden="true"
      className={cn(!options.plain && ["h-3.5 w-3.5", tone], options.className)}
    />
  );
}

/** The action as a badge: icon and name, coloured by what kind of action it is. */
export function ActivityActionBadge({
  action,
  resource,
  className,
}: {
  action: string;
  resource?: string;
  className?: string;
}) {
  const labels = useActivityLabels();
  const style = styleOf(action);

  return (
    <Badge variant={style.variant} className={cn(style.badgeClassName, className)}>
      {getActionIcon(action, { resource, plain: true })}
      {labels.action(action)}
    </Badge>
  );
}

/** A red marker with its word: a failure is never conveyed by colour alone. */
export function FailedMarker({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
      <OctagonAlert aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}
