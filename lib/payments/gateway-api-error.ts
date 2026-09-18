/**
 * A payment gateway answering a request with an error, and whether asking
 * again could get a different answer.
 *
 * A webhook that reads the gateway before it moves money has two ways to fail
 * and they want opposite handling. An outage (a 5xx, a timeout, a dropped
 * connection) should fail the delivery so the gateway sends it again. A refusal
 * (a missing permission, an id the account does not have) will be refused on
 * every retry, so the delivery is better answered with what the event itself
 * says than retried until the gateway gives up on it.
 */
export class GatewayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GatewayApiError";
  }
}

/** True for anything that is not a gateway's considered refusal. */
export function isRetryableGatewayError(error: unknown): boolean {
  if (error instanceof GatewayApiError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  // No status at all: the request never got an answer.
  return true;
}
