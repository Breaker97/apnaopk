/**
 * The plan new vendors are steered to.
 *
 * The admin marks it on the plan itself ("Default"): the wizard shows it as
 * Recommended and pre-selects it, and an application that names no plan gets
 * it. `vendorConfig.defaultPlanId` predates that switch and has no screen of
 * its own, so it only counts when no offered plan is marked.
 */
export function pickDefaultVendorPlanId(
  offeredPlans: readonly { id: string; isDefault?: boolean }[],
  configuredPlanId?: string | null,
): string | null {
  const marked = offeredPlans.find((plan) => plan.isDefault);
  if (marked) return marked.id;
  if (
    configuredPlanId &&
    offeredPlans.some((plan) => plan.id === configuredPlanId)
  ) {
    return configuredPlanId;
  }
  return null;
}
