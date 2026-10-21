/** Status meaning stays independent of merchant promotional colors. */
export const STATUS_CLASSES = {
  positive:'bg-status-positive text-status-on-positive',
  negative:'bg-status-negative text-status-on-negative',
  warning:'bg-status-warning text-status-on-warning',
  info:'bg-status-info text-status-on-info',
  neutral:'bg-status-neutral text-status-on-neutral',
} as const;
export const ORDER_STATUS_CLASSES: Record<string,string> = {
  pending:STATUS_CLASSES.warning,preordered:STATUS_CLASSES.warning,
  processing:STATUS_CLASSES.info,shipped:STATUS_CLASSES.info,out_for_delivery:STATUS_CLASSES.info,
  delivered:STATUS_CLASSES.positive,cancelled:STATUS_CLASSES.negative,failed:STATUS_CLASSES.negative,
  refunded:STATUS_CLASSES.neutral,returned:STATUS_CLASSES.neutral,
};
export const LOYALTY_CLASSES = {
  bronze:'bg-tier-bronze text-tier-on-bronze border-current/25',
  silver:'bg-tier-silver text-tier-on-silver border-current/25',
  gold:'bg-tier-gold text-tier-on-gold border-current/25',
  platinum:'bg-tier-platinum text-tier-on-platinum border-current/25',
};
