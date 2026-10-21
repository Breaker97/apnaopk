/**
 * The day a payout's money came back, as the admin picks it, turned into the
 * moment the API records.
 *
 * The screen asks for a calendar day, but the API validates an exact instant
 * that must fall between the payment and now. Sending noon of the picked day
 * as it was, a payment made at 14:00 and returned the same afternoon was
 * refused ("Invalid return date") when the admin picked that very day, and
 * picking today before noon sent a moment in the future. So the day becomes
 * noon in the admin's own timezone, held between the payment and now — always
 * a moment the API accepts, and always on the day that was picked.
 */

/** A date's calendar day in the browser's timezone, as `YYYY-MM-DD`. */
export function localCalendarDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The instant to record for a payment that came back on `day` (`YYYY-MM-DD`, local). */
export function returnInstantForDay(day: string, paidAt: Date, now: Date): Date {
  const noon = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(noon.getTime())) return now;
  return new Date(Math.min(Math.max(noon.getTime(), paidAt.getTime()), now.getTime()));
}
