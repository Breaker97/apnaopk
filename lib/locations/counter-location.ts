/**
 * Whether a register may stand at a location.
 *
 * The third question a place has to answer, alongside "may the public collect
 * here" (`pickupEnabled`) and "may a posted order leave from here"
 * (`fulfillsOnlineOrders`). Neither of those can stand in for it: a collection
 * counter admits the public and sells nothing, a shop floor with collection
 * switched off still has a till, and `fulfillsOnlineOrders` defaults true so
 * almost every row answers yes and it filters nothing at all.
 *
 * Import-free and free of `server-only`, like `lib/locations/dispatch-order.ts`
 * and for the same reason: the POS shell filters the list it offers a cashier
 * and the locations screen labels the same rows, so one implementation keeps
 * the badge a merchant reads from disagreeing with the picker a cashier sees.
 */

/**
 * `!== false` rather than `=== true`: every row written before this field
 * existed carries nothing, and a store whose registers worked yesterday must
 * not find every counter missing because a migration has not run.
 *
 * That default is the opposite of `pickupEnabled`'s, which is off until a
 * merchant opts in. The two answer different kinds of question. Publishing a
 * warehouse address to the public is a disclosure and has to be chosen;
 * appearing in a list only this merchant's own staff can see is not, and
 * defaulting it off would empty every existing register instead.
 */
export function sellsAtCounter(location: {
  isActive?: boolean;
  sellsAtCounter?: boolean;
}): boolean {
  return location.isActive !== false && location.sellsAtCounter !== false;
}
