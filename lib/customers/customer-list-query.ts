/**
 * The customers list's URL, as `CustomerListQuerySchema` reads it.
 *
 * The URL names the email-subscription filter `subscription` (what the control
 * is called) and the schema takes `emailSubscription`; and a select left on
 * "all" is no filter, so "all" is not a value either of them would accept.
 * Doing this once, here, is what lets a pasted link, the page, and the CSV
 * export agree on what a query string means.
 */

type RawParams = Record<string, string | string[] | undefined>;

function filterValue(value: string | string[] | undefined) {
  return typeof value === "string" && value !== "all" ? value : undefined;
}

export function customerListQueryParams(raw: RawParams): RawParams {
  const { subscription, ...rest } = raw;
  return {
    ...rest,
    emailSubscription:
      filterValue(subscription) ?? filterValue(rest.emailSubscription),
    tag: filterValue(rest.tag),
  };
}
