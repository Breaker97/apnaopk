/**
 * The legal ranges for the numbers on Settings → Security.
 *
 * Each of these is read in three places — the admin tab clamps what can be
 * typed, the settings API refuses to store anything outside the range, and the
 * consumer clamps again on read so a store already holding a bad value keeps
 * working. Three copies of a number is how the screen ends up offering a value
 * the server rejects, which is exactly what it was doing: the tab allowed a
 * seven-day lockout that the storage silently cut to one, and a six-character
 * password minimum that the policy quietly raised to eight.
 *
 * Deliberately free of server-only imports so the client tab can share it.
 */

export const MIN_SESSION_MAX_AGE_DAYS = 1;
export const MAX_SESSION_MAX_AGE_DAYS = 365;
export const DEFAULT_SESSION_MAX_AGE_DAYS = 7;

/**
 * `0` is meaningful — it is the off switch, since the Security tab has no
 * separate toggle. See `lib/login-lockout.ts` for why a sub-one budget cannot
 * be read as "lock after zero failures".
 */
export const MIN_LOGIN_ATTEMPTS = 0;
export const MAX_LOGIN_ATTEMPTS = 100;
/**
 * Ten, not five. Five is enough to lock out a merchant who simply cannot
 * remember which of their passwords this store uses, and the cost of that — a
 * shop owner shut out of their own admin — is far higher than the marginal
 * protection those five extra guesses give away. Online guessing is bounded by
 * Better Auth's per-IP request limit long before it is bounded by this number.
 */
export const DEFAULT_MAX_LOGIN_ATTEMPTS = 10;

/**
 * How close to the limit a signed-out visitor starts being warned. Telling
 * someone their account is *about* to lock is the difference between a control
 * that feels fair and one that feels broken; it gives an attacker nothing they
 * could not learn by counting their own failures.
 */
export const ATTEMPTS_WARNING_THRESHOLD = 3;

export const MIN_LOCKOUT_MINUTES = 1;
/**
 * One day, and not a minute more: `LoginAttempt` carries a TTL index that drops
 * a record 24 hours after its last write, so a longer lockout would expire
 * early and without a trace. Raising this means raising that index too.
 */
export const MAX_LOCKOUT_MINUTES = 1440;
export const DEFAULT_LOCKOUT_MINUTES = 15;
