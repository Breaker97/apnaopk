import { ServiceUnavailableError, ValidationError } from "@/lib/api/errors";
import type {
  IChannelConnection,
  MessageProvider,
} from "@/models/channel-connection.model";
import { decryptMessagingSecret } from "@/lib/conversations/secret-box";

function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION?.trim();
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new ServiceUnavailableError(
      "META_GRAPH_API_VERSION is not configured",
      undefined,
      "META_GRAPH_VERSION_NOT_CONFIGURED",
    );
  }
  return version;
}

/** Meta codes that mean the stored token is dead — retrying cannot help. */
const META_AUTH_ERROR_CODES = new Set([102, 190, 463, 467]);

/** Meta codes that mean "slow down", not "this will never work". */
const META_THROTTLE_ERROR_CODES = new Set([4, 17, 32, 613, 80007, 131056]);

/**
 * Meta codes that are terminal for THIS message: the payload, recipient or
 * template is unacceptable, so the outbox should dead-letter it immediately
 * instead of burning eight retries on a guaranteed rejection.
 */
const META_PERMANENT_ERROR_CODES = new Set([
  10, // permission denied
  100, // invalid parameter
  131026, // message undeliverable
  131047, // re-engagement required (24h window closed)
  131051, // unsupported message type
  131052, // media download error
  131053, // media upload error
  132000, // template param count mismatch
  132001, // template does not exist
  132005, // template hydrated text too long
  132007, // template format character policy violated
  132012, // template parameter format mismatch
  132015, // template is paused
  132016, // template is disabled
  368, // temporarily blocked for policy violations
]);

/**
 * A Graph API failure with Meta's structured error preserved.
 *
 * The previous `new Error(payload.error.message)` destroyed `code` /
 * `error_subcode` at the transport boundary, which left every caller unable to
 * tell a revoked token from a rate limit from a malformed template — so all
 * three were retried identically.
 */
export class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: number;
    subcode?: number;
    type?: string;
    fbtraceId?: string;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "MetaGraphError";
    this.status = params.status;
    this.code = params.code;
    this.subcode = params.subcode;
    this.type = params.type;
    this.fbtraceId = params.fbtraceId;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  /** The connection's token is invalid or revoked; the connection is dead. */
  get isAuthFailure() {
    return (
      (this.code !== undefined && META_AUTH_ERROR_CODES.has(this.code)) ||
      (this.subcode !== undefined && META_AUTH_ERROR_CODES.has(this.subcode)) ||
      this.status === 401
    );
  }

  /** Rate limited: retry later, with a longer delay. */
  get isThrottled() {
    return (
      this.status === 429 ||
      (this.code !== undefined && META_THROTTLE_ERROR_CODES.has(this.code))
    );
  }

  /** Retrying this exact request will never succeed. */
  get isPermanent() {
    if (this.isThrottled) return false;
    if (this.isAuthFailure) return true;
    if (this.code !== undefined && META_PERMANENT_ERROR_CODES.has(this.code)) {
      return true;
    }
    // Meta's permission errors occupy 200-299. Everything else 4xx that we do
    // not recognise stays retryable, so an unknown code degrades safely.
    if (this.code !== undefined && this.code >= 200 && this.code <= 299) {
      return true;
    }
    return false;
  }
}

function positiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function graphRequest<T>(params: {
  path: string;
  token: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion()}/${params.path}`,
    {
      method: params.method || "GET",
      headers: {
        Authorization: `Bearer ${params.token}`,
        ...(params.body ? { "Content-Type": "application/json" } : {}),
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | (T & {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          type?: string;
          fbtrace_id?: string;
        };
      })
    | null;
  if (!response.ok || !payload) {
    throw new MetaGraphError({
      message:
        payload?.error?.message || `Meta Graph API returned ${response.status}`,
      status: response.status,
      code: payload?.error?.code,
      subcode: payload?.error?.error_subcode,
      type: payload?.error?.type,
      fbtraceId: payload?.error?.fbtrace_id,
      retryAfterSeconds: positiveInteger(response.headers.get("retry-after")),
    });
  }
  return payload;
}

/**
 * Exchanges a Facebook Login for Business code for a user access token.
 *
 * Shared by both Embedded Signup flows: WhatsApp additionally needs
 * `expires_in` to record the token's expiry, which is why this returns the
 * lifetime alongside the token rather than the token alone.
 */
async function exchangeLoginCode(code: string) {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new ServiceUnavailableError(
      "Meta Embedded Signup is not configured",
      undefined,
      "META_EMBEDDED_SIGNUP_NOT_CONFIGURED",
    );
  }
  const tokenUrl = new URL(
    `https://graph.facebook.com/${graphVersion()}/oauth/access_token`,
  );
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);
  const response = await fetch(tokenUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.access_token) {
    // Every failure here is Meta *account* configuration the admin has to fix in
    // the App Dashboard, so a bare 500 carrying Meta's sentence alone sends them
    // to support instead of to the fields that are actually wrong. The one they
    // hit most is "make sure your redirect_uri is identical…", which means the
    // code never came from a Facebook Login for Business popup: either the
    // configuration ID belongs to "Instagram API with Instagram Login" — a
    // different endpoint that does require a redirect_uri — or the popup was
    // suppressed and the SDK fell back to a full-page redirect, which binds the
    // code to a redirect_uri this exchange deliberately does not send.
    throw new ValidationError(
      `${payload?.error?.message || "Meta did not exchange the sign-up code"}. ` +
        "Check that the configuration ID is a Facebook Login for Business " +
        "configuration (not an Instagram Login one), that this page's domain is " +
        "listed under both Allowed Domains for the JavaScript SDK and Valid " +
        "OAuth Redirect URIs, and that pop-ups are not blocked for this site.",
    );
  }
  return {
    accessToken: payload.access_token,
    expiresInSeconds:
      payload.expires_in && payload.expires_in > 0
        ? payload.expires_in
        : undefined,
  };
}

/**
 * Instagram onboarding via Facebook Login for Business.
 *
 * Unlike WhatsApp — where the SDK hands back the WABA and phone directly —
 * Instagram Direct is reached through a Facebook Page, so the account has to be
 * discovered: exchange the code, walk the admin's Pages, and take the one that
 * actually has a linked Instagram professional account. The Page's own token is
 * what the send and profile calls will use afterwards.
 */
export async function completeInstagramEmbeddedSignup(params: {
  code: string;
  /** Optional: pick a specific Page when the admin manages several. */
  pageId?: string;
}) {
  const { accessToken: userToken } = await exchangeLoginCode(params.code);
  const accounts = await graphRequest<{
    data?: Array<{
      id: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: {
        id?: string;
        username?: string;
        name?: string;
      };
    }>;
  }>({
    path: "me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100",
    token: userToken,
  });
  const candidates = (accounts.data || []).filter(
    (page) => page.instagram_business_account?.id && page.access_token,
  );
  if (!candidates.length) {
    throw new ValidationError(
      "No Facebook Page with a linked Instagram professional account was found. Link the Instagram account to a Page you administer, then try again.",
    );
  }
  const page = params.pageId
    ? candidates.find((candidate) => candidate.id === params.pageId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!page) {
    throw new ValidationError(
      `Select which Page to connect: ${candidates
        .map((candidate) => `${candidate.name || candidate.id} (${candidate.id})`)
        .join(", ")}`,
    );
  }
  const instagram = page.instagram_business_account!;
  // Without this the Page produces no webhooks, so the inbox would stay empty
  // even though the connection looks healthy.
  await graphRequest<{ success?: boolean }>({
    path: `${encodeURIComponent(page.id)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_seen`,
    token: page.access_token!,
    method: "POST",
  });
  return {
    accessToken: page.access_token!,
    instagramUserId: instagram.id!,
    publicInstagramUsername: instagram.username,
    displayName: instagram.name || instagram.username || page.name,
    externalAccountId: instagram.id,
  };
}

export async function completeWhatsAppEmbeddedSignup(params: {
  code: string;
  businessAccountId: string;
  phoneNumberId: string;
}) {
  const { accessToken, expiresInSeconds } = await exchangeLoginCode(
    params.code,
  );
  const phoneNumbers = await graphRequest<{
    data?: Array<{
      id: string;
      display_phone_number?: string;
      verified_name?: string;
    }>;
  }>({
    path: `${encodeURIComponent(params.businessAccountId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
    token: accessToken,
  });
  const phone = phoneNumbers.data?.find(
    (entry) => entry.id === params.phoneNumberId,
  );
  if (!phone) {
    throw new ValidationError(
      "The selected phone number does not belong to the selected WhatsApp Business Account",
    );
  }
  await graphRequest<{ success?: boolean }>({
    path: `${encodeURIComponent(params.businessAccountId)}/subscribed_apps`,
    token: accessToken,
    method: "POST",
  });
  return {
    accessToken,
    businessAccountId: params.businessAccountId,
    phoneNumberId: params.phoneNumberId,
    publicPhoneNumberE164: phone.display_phone_number,
    displayName: phone.verified_name || phone.display_phone_number,
    tokenExpiresAt: expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : undefined,
  };
}

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<{
    type?: string;
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string[];
    otp_type?: string;
  }>;
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
}

interface MetaWhatsAppTemplate {
  id?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameter_format?: "POSITIONAL" | "NAMED";
  components?: MetaTemplateComponent[];
  quality_score?: Record<string, unknown>;
}

export interface MetaTemplateSendComponent {
  type: "header" | "body" | "button";
  sub_type?: "url";
  index?: string;
  parameters: Array<
    | { type: "text"; text: string; parameter_name?: string }
    | { type: "image"; image: { link: string } }
    | { type: "video"; video: { link: string } }
    | { type: "document"; document: { link: string; filename?: string } }
  >;
}

export async function verifyMetaConnection(params: {
  provider: MessageProvider;
  accessToken: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  pageId?: string;
  instagramUserId?: string;
}) {
  if (params.provider === "whatsapp") {
    if (!params.phoneNumberId) {
      throw new ValidationError("WhatsApp phone number ID is required");
    }
    const result = await graphRequest<{
      id: string;
      display_phone_number?: string;
      verified_name?: string;
    }>({
      path: `${encodeURIComponent(params.phoneNumberId)}?fields=id,display_phone_number,verified_name`,
      token: params.accessToken,
    });
    if (params.businessAccountId) {
      await graphRequest<{ id: string; name?: string }>({
        path: `${encodeURIComponent(params.businessAccountId)}?fields=id,name`,
        token: params.accessToken,
      });
    }
    return {
      externalAccountId: result.id,
      displayName:
        result.verified_name || result.display_phone_number || "WhatsApp",
      publicPhoneNumber: result.display_phone_number,
    };
  }

  if (params.provider === "instagram") {
    if (!params.instagramUserId) {
      throw new ValidationError("Instagram professional account ID is required");
    }
    // Instagram Direct is served by the Messenger Platform: the credential is
    // the linked Page's access token, and the identity is the Instagram
    // professional account it manages.
    const result = await graphRequest<{
      id: string;
      username?: string;
      name?: string;
    }>({
      path: `${encodeURIComponent(params.instagramUserId)}?fields=id,username,name`,
      token: params.accessToken,
    });
    return {
      externalAccountId: result.id,
      displayName: result.name || result.username || "Instagram",
      publicInstagramUsername: result.username,
    };
  }

  if (!params.pageId) {
    throw new ValidationError("Messenger page ID is required");
  }
  const result = await graphRequest<{
    id: string;
    name?: string;
    username?: string;
    link?: string;
  }>({
    path: `${encodeURIComponent(params.pageId)}?fields=id,name,username,link`,
    token: params.accessToken,
  });
  return {
    externalAccountId: result.id,
    displayName: result.name || "Messenger",
    publicPageUsername:
      result.username ||
      result.link?.match(/facebook\.com\/([^/?#]+)/i)?.[1],
  };
}

export async function verifyStoredMetaConnection(
  connection: IChannelConnection,
) {
  return verifyMetaConnection({
    provider: connection.provider,
    accessToken: decryptMessagingSecret(connection.accessTokenEncrypted),
    businessAccountId: connection.businessAccountId,
    phoneNumberId: connection.phoneNumberId,
    pageId: connection.pageId,
    instagramUserId: connection.instagramUserId,
  });
}

export async function fetchWhatsAppTemplates(
  connection: IChannelConnection,
): Promise<MetaWhatsAppTemplate[]> {
  if (connection.provider !== "whatsapp") {
    throw new ValidationError("WhatsApp connection is required");
  }
  if (!connection.businessAccountId) {
    throw new ValidationError(
      "WhatsApp Business Account ID is required before templates can be synchronized",
    );
  }
  const token = decryptMessagingSecret(connection.accessTokenEncrypted);
  const templates: MetaWhatsAppTemplate[] = [];
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({
      fields:
        "id,name,language,category,status,parameter_format,components,quality_score",
      limit: "100",
    });
    if (after) query.set("after", after);
    const result = await graphRequest<{
      data?: MetaWhatsAppTemplate[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>({
      path: `${encodeURIComponent(connection.businessAccountId)}/message_templates?${query.toString()}`,
      token,
    });
    if (Array.isArray(result.data)) templates.push(...result.data);
    const nextAfter = result.paging?.cursors?.after;
    if (!result.paging?.next || !nextAfter) break;
    after = nextAfter;
  }

  return templates;
}

export async function createWhatsAppTextTemplate(params: {
  connection: IChannelConnection;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  headerText?: string;
  headerExample?: string;
  bodyText: string;
  bodyExamples: string[];
  footerText?: string;
  button?: {
    type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
    text: string;
    value?: string;
    example?: string;
  };
  authentication?: {
    addSecurityRecommendation: boolean;
    codeExpirationMinutes: number;
  };
}) {
  if (
    params.connection.provider !== "whatsapp" ||
    !params.connection.businessAccountId
  ) {
    throw new ValidationError(
      "A WhatsApp Business Account connection is required",
    );
  }
  const token = decryptMessagingSecret(
    params.connection.accessTokenEncrypted,
  );
  const components: MetaTemplateComponent[] = [];
  if (params.category === "AUTHENTICATION") {
    components.push({
      type: "BODY",
      add_security_recommendation:
        params.authentication?.addSecurityRecommendation !== false,
    });
    components.push({
      type: "FOOTER",
      code_expiration_minutes:
        params.authentication?.codeExpirationMinutes || 10,
    });
    components.push({
      type: "BUTTONS",
      buttons: [{ type: "OTP", otp_type: "COPY_CODE" }],
    });
  }
  if (params.category !== "AUTHENTICATION" && params.headerText) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: params.headerText,
      ...(params.headerExample
        ? { example: { header_text: [params.headerExample] } }
        : {}),
    });
  }
  if (params.category !== "AUTHENTICATION") {
    components.push({
      type: "BODY",
      text: params.bodyText,
      ...(params.bodyExamples.length
        ? { example: { body_text: [params.bodyExamples] } }
        : {}),
    });
    if (params.footerText) {
      components.push({ type: "FOOTER", text: params.footerText });
    }
    if (params.button) {
      components.push({
        type: "BUTTONS",
        buttons: [
          {
            type: params.button.type,
            text: params.button.text,
            ...(params.button.type === "URL"
              ? {
                  url: params.button.value,
                  ...(params.button.example
                    ? { example: [params.button.example] }
                    : {}),
                }
              : {}),
            ...(params.button.type === "PHONE_NUMBER"
              ? { phone_number: params.button.value }
              : {}),
          },
        ],
      });
    }
  }
  const result = await graphRequest<{
    id?: string;
    status?: string;
    category?: string;
  }>({
    path: `${encodeURIComponent(params.connection.businessAccountId)}/message_templates`,
    token,
    method: "POST",
    body: {
      name: params.name,
      language: params.language,
      category: params.category,
      parameter_format: "POSITIONAL",
      components,
    },
  });
  if (!result.id) throw new Error("Meta did not return a template ID");
  return {
    id: result.id,
    status: result.status || "PENDING",
    category: result.category || params.category,
    components,
  };
}

/**
 * The Graph node a Messenger-Platform send is POSTed to. Messenger addresses
 * the Page; Instagram Direct addresses the Instagram professional account —
 * with the same linked-Page token, the same request body and the same
 * `messaging_type` / `HUMAN_AGENT` semantics. Only the node differs, so the two
 * channels share every send path below.
 */
function messengerPlatformNodeId(connection: IChannelConnection) {
  if (connection.provider === "instagram") {
    if (!connection.instagramUserId) {
      throw new Error("Instagram professional account ID is missing");
    }
    return connection.instagramUserId;
  }
  if (!connection.pageId) {
    throw new Error("Messenger page ID is missing");
  }
  return connection.pageId;
}

export async function sendMetaTextMessage(params: {
  connection: IChannelConnection;
  recipientId: string;
  text: string;
  messengerHumanAgent?: boolean;
}) {
  const token = decryptMessagingSecret(params.connection.accessTokenEncrypted);
  if (params.connection.provider === "whatsapp") {
    if (!params.connection.phoneNumberId) {
      throw new Error("WhatsApp phone number ID is missing");
    }
    const result = await graphRequest<{
      messages?: Array<{ id?: string }>;
    }>({
      path: `${encodeURIComponent(params.connection.phoneNumberId)}/messages`,
      token,
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.recipientId,
        type: "text",
        text: { preview_url: false, body: params.text },
      },
    });
    const providerMessageId = result.messages?.[0]?.id;
    if (!providerMessageId) throw new Error("Meta did not return a message ID");
    return providerMessageId;
  }

  const result = await graphRequest<{ message_id?: string }>({
    path: `${encodeURIComponent(messengerPlatformNodeId(params.connection))}/messages`,
    token,
    method: "POST",
    body: {
      recipient: { id: params.recipientId },
      messaging_type: params.messengerHumanAgent
        ? "MESSAGE_TAG"
        : "RESPONSE",
      ...(params.messengerHumanAgent ? { tag: "HUMAN_AGENT" } : {}),
      message: { text: params.text },
    },
  });
  if (!result.message_id) throw new Error("Meta did not return a message ID");
  return result.message_id;
}

export async function sendMetaAttachmentMessage(params: {
  connection: IChannelConnection;
  recipientId: string;
  attachment: {
    type: "image" | "video" | "audio" | "document";
    url: string;
    name?: string;
  };
  caption?: string;
  messengerHumanAgent?: boolean;
}) {
  const token = decryptMessagingSecret(params.connection.accessTokenEncrypted);
  if (params.connection.provider === "whatsapp") {
    if (!params.connection.phoneNumberId) {
      throw new Error("WhatsApp phone number ID is missing");
    }
    const media = {
      link: params.attachment.url,
      ...(["image", "video", "document"].includes(params.attachment.type) &&
      params.caption?.trim()
        ? { caption: params.caption.trim() }
        : {}),
      ...(params.attachment.type === "document" && params.attachment.name
        ? { filename: params.attachment.name }
        : {}),
    };
    const result = await graphRequest<{
      messages?: Array<{ id?: string }>;
    }>({
      path: `${encodeURIComponent(params.connection.phoneNumberId)}/messages`,
      token,
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.recipientId,
        type: params.attachment.type,
        [params.attachment.type]: media,
      },
    });
    const providerMessageId = result.messages?.[0]?.id;
    if (!providerMessageId) throw new Error("Meta did not return a message ID");
    return providerMessageId;
  }

  const messengerType =
    params.attachment.type === "document" ? "file" : params.attachment.type;
  const result = await graphRequest<{ message_id?: string }>({
    path: `${encodeURIComponent(messengerPlatformNodeId(params.connection))}/messages`,
    token,
    method: "POST",
    body: {
      recipient: { id: params.recipientId },
      messaging_type: params.messengerHumanAgent
        ? "MESSAGE_TAG"
        : "RESPONSE",
      ...(params.messengerHumanAgent ? { tag: "HUMAN_AGENT" } : {}),
      message: {
        attachment: {
          type: messengerType,
          payload: {
            url: params.attachment.url,
            is_reusable: true,
          },
        },
      },
    },
  });
  if (!result.message_id) throw new Error("Meta did not return a message ID");
  return result.message_id;
}

export async function sendMetaTemplateMessage(params: {
  connection: IChannelConnection;
  recipientId: string;
  template: {
    name: string;
    language: string;
    components: MetaTemplateSendComponent[];
  };
}) {
  if (params.connection.provider !== "whatsapp") {
    throw new ValidationError(
      "Provider templates are currently supported for WhatsApp only",
    );
  }
  if (!params.connection.phoneNumberId) {
    throw new Error("WhatsApp phone number ID is missing");
  }
  const token = decryptMessagingSecret(
    params.connection.accessTokenEncrypted,
  );
  const result = await graphRequest<{
    messages?: Array<{ id?: string }>;
  }>({
    path: `${encodeURIComponent(params.connection.phoneNumberId)}/messages`,
    token,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.recipientId,
      type: "template",
      template: {
        name: params.template.name,
        language: {
          policy: "deterministic",
          code: params.template.language,
        },
        ...(params.template.components.length
          ? { components: params.template.components }
          : {}),
      },
    },
  });
  const providerMessageId = result.messages?.[0]?.id;
  if (!providerMessageId) throw new Error("Meta did not return a message ID");
  return providerMessageId;
}

/**
 * Resolves who a Messenger Platform sender actually is.
 *
 * The webhook only carries an opaque scoped ID (a PSID for Messenger, an IGSID
 * for Instagram), so without this lookup the inbox labels every such customer
 * with a long number. WhatsApp does not need it — its webhook already includes
 * `contacts[].profile.name`.
 *
 * Returns undefined rather than throwing: a missing display name must never
 * cost us the message itself.
 */
export async function fetchMessengerPlatformProfile(params: {
  connection: IChannelConnection;
  externalUserId: string;
}) {
  // Second gate, deliberately duplicated with the ingest-side capability check:
  // this function decrypts a connection credential and sends it to Meta, so it
  // must refuse any provider that is not a Messenger Platform one rather than
  // trusting its caller. Telegram reaching here leaked the bot token.
  if (
    params.connection.provider !== "messenger" &&
    params.connection.provider !== "instagram"
  ) {
    return undefined;
  }
  const instagram = params.connection.provider === "instagram";
  const fields = instagram
    ? "name,username"
    : "first_name,last_name,profile_pic";
  try {
    const token = decryptMessagingSecret(
      params.connection.accessTokenEncrypted,
    );
    const profile = await graphRequest<{
      name?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    }>({
      path: `${encodeURIComponent(params.externalUserId)}?fields=${fields}`,
      token,
    });
    const name = instagram
      ? profile.name || profile.username
      : [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    return {
      name: name?.trim() || undefined,
      username: profile.username?.trim() || undefined,
      image: profile.profile_pic?.trim() || undefined,
    };
  } catch (error) {
    // Profile access is a separate Meta permission and is commonly missing in
    // development; the conversation is still worth more than the label.
    console.error("Meta profile lookup failed:", error);
    return undefined;
  }
}

/**
 * Messenger Platform read receipt. Unlike WhatsApp — which marks a specific
 * message id — Messenger and Instagram mark the whole thread as seen for one
 * recipient, so this takes the recipient rather than a message.
 */
export async function markMessengerPlatformSeen(params: {
  connection: IChannelConnection;
  recipientId: string;
}) {
  if (params.connection.provider === "whatsapp") {
    throw new ValidationError("A Messenger Platform connection is required");
  }
  const token = decryptMessagingSecret(params.connection.accessTokenEncrypted);
  await graphRequest<{ recipient_id?: string }>({
    path: `${encodeURIComponent(messengerPlatformNodeId(params.connection))}/messages`,
    token,
    method: "POST",
    body: {
      recipient: { id: params.recipientId },
      sender_action: "mark_seen",
    },
  });
}

export async function markWhatsAppMessageRead(params: {
  connection: IChannelConnection;
  providerMessageId: string;
}) {
  if (
    params.connection.provider !== "whatsapp" ||
    !params.connection.phoneNumberId
  ) {
    throw new ValidationError("WhatsApp connection is required");
  }
  const token = decryptMessagingSecret(
    params.connection.accessTokenEncrypted,
  );
  await graphRequest<{ success?: boolean }>({
    path: `${encodeURIComponent(params.connection.phoneNumberId)}/messages`,
    token,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      status: "read",
      message_id: params.providerMessageId,
    },
  });
}

const META_MEDIA_HOST_SUFFIXES = [
  "facebook.com",
  "fbcdn.net",
  "fbsbx.com",
  "cdninstagram.com",
] as const;

function isMetaMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      META_MEDIA_HOST_SUFFIXES.some(
        (suffix) =>
          url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}

export async function fetchWhatsAppMedia(params: {
  connection: IChannelConnection;
  mediaId: string;
}) {
  if (params.connection.provider !== "whatsapp") {
    throw new ValidationError("WhatsApp connection is required");
  }
  const token = decryptMessagingSecret(
    params.connection.accessTokenEncrypted,
  );
  const metadata = await graphRequest<{
    id: string;
    url?: string;
    mime_type?: string;
    file_size?: number;
  }>({
    path: encodeURIComponent(params.mediaId),
    token,
  });
  if (!metadata.url || !isMetaMediaUrl(metadata.url)) {
    throw new Error("Meta returned an invalid media URL");
  }
  const response = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Meta media download returned ${response.status}`);
  }
  const contentLength = Number(
    response.headers.get("content-length") || metadata.file_size || 0,
  );
  if (contentLength > 32 * 1024 * 1024) {
    await response.body.cancel();
    throw new ValidationError("Meta media file is too large to preview");
  }
  return {
    body: response.body,
    contentType:
      response.headers.get("content-type") ||
      metadata.mime_type ||
      "application/octet-stream",
    contentLength: contentLength || undefined,
  };
}
