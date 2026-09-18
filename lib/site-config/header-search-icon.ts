/**
 * Whether pressing the header's search icon should SUBMIT the search, or
 * only open its field.
 *
 * The header keeps its query after a search — and the listing re-fills it
 * from the URL — so a plain icon's closed field usually still holds the last
 * term. Submitting whenever that text existed turned every later click into
 * "go back to the previous results". A search runs only from a field the
 * shopper can see holding a query: the capsule always shows its field; the
 * plain icon only while its field is open.
 */
export function searchIconShouldSubmit({
  pill,
  fieldWasOpen,
  query,
}: {
  /** The capsule style, whose field is always on screen. */
  pill: boolean;
  /** The plain style's field had focus when the icon was pressed. */
  fieldWasOpen: boolean;
  query: string;
}): boolean {
  return (pill || fieldWasOpen) && query.trim().length > 0;
}
