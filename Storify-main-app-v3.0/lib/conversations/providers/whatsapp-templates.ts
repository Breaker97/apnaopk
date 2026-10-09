import { Types } from "mongoose";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import {
  ChannelConnection,
  WhatsAppTemplate,
} from "@/models";
import {
  CHANNEL_CONNECTION_STATUSES,
  type IChannelConnection,
} from "@/models/channel-connection.model";
import {
  WHATSAPP_TEMPLATE_STATUSES,
  type IWhatsAppTemplate,
  type IWhatsAppTemplateComponent,
} from "@/models/whatsapp-template.model";
import type {
  ConversationViewer,
  WhatsAppTemplateDTO,
  WhatsAppTemplateVariableDTO,
} from "@/lib/conversations/types";
import { assertVendorChannelPermission } from "@/lib/conversations/viewer";
import {
  createWhatsAppTextTemplate,
  fetchWhatsAppTemplates,
  type MetaTemplateSendComponent,
} from "@/lib/conversations/providers/meta-client";

/**
 * Sending an authentication template needs the OTP button component that the
 * compiler does not build yet, so the category is refused on create and hidden
 * from the composer rather than shipped as a guaranteed Meta rejection.
 */
const AUTHENTICATION_TEMPLATE_CATEGORY = "AUTHENTICATION";

function objectId(value: string, label: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new ValidationError(`${label} is invalid`);
  }
  return new Types.ObjectId(value);
}

function channelOwnerKey(viewer: ConversationViewer) {
  if (viewer.kind === "admin") return "platform";
  if (viewer.kind === "vendor") {
    assertVendorChannelPermission(viewer);
    return `vendor:${viewer.vendorId}`;
  }
  throw new AuthorizationError(
    "Only store users can manage WhatsApp templates",
  );
}

async function ownedWhatsAppConnection(
  viewer: ConversationViewer,
  connectionId: string,
) {
  const connection = await ChannelConnection.findOne({
    _id: objectId(connectionId, "Channel connection"),
    ownerKey: channelOwnerKey(viewer),
    provider: "whatsapp",
    status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
  });
  if (!connection) throw new NotFoundError("WhatsApp connection");
  return connection;
}

function textTokens(value: string | undefined) {
  if (!value) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(/{{\s*([a-zA-Z_][\w]*|\d+)\s*}}/g)) {
    const token = match[1];
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

function templateTextTokens(
  value: string | undefined,
  parameterFormat: "POSITIONAL" | "NAMED",
) {
  const tokens = textTokens(value);
  return parameterFormat === "POSITIONAL"
    ? tokens.sort((a, b) => Number(a) - Number(b))
    : tokens;
}

function exampleValue(
  component: IWhatsAppTemplateComponent,
  componentType: "header" | "body",
  token: string,
  tokenIndex: number,
) {
  const example = component.example || {};
  const namedKey = `${componentType}_text_named_params`;
  const named = Array.isArray(example[namedKey])
    ? (example[namedKey] as Array<Record<string, unknown>>)
    : [];
  const namedMatch = named.find(
    (item) => String(item.param_name || "") === token,
  );
  if (namedMatch?.example) return String(namedMatch.example);

  const positionalKey = `${componentType}_text`;
  const positional = example[positionalKey];
  const values =
    componentType === "body" &&
    Array.isArray(positional) &&
    Array.isArray(positional[0])
      ? positional[0]
      : positional;
  return Array.isArray(values) && values[tokenIndex] !== undefined
    ? String(values[tokenIndex])
    : undefined;
}

export function getWhatsAppTemplateVariables(
  template: Pick<IWhatsAppTemplate, "components" | "parameterFormat">,
): WhatsAppTemplateVariableDTO[] {
  const variables: WhatsAppTemplateVariableDTO[] = [];
  for (const component of template.components || []) {
    const componentType = component.type?.toUpperCase();
    if (componentType === "HEADER") {
      const format = component.format?.toUpperCase() || "TEXT";
      if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
        const handles = component.example?.header_handle;
        variables.push({
          key: "header:media",
          label: `${format[0]}${format.slice(1).toLowerCase()} URL`,
          component: "header",
          type: format.toLowerCase() as "image" | "video" | "document",
          example:
            Array.isArray(handles) && handles[0]
              ? String(handles[0])
              : undefined,
        });
        continue;
      }
      templateTextTokens(component.text, template.parameterFormat).forEach(
        (token, index) => {
        variables.push({
          key: `header:${token}`,
          label: `Header ${token}`,
          component: "header",
          type: "text",
          parameterName:
            template.parameterFormat === "NAMED" ? token : undefined,
          example: exampleValue(component, "header", token, index),
        });
        },
      );
      continue;
    }
    if (componentType === "BODY") {
      templateTextTokens(component.text, template.parameterFormat).forEach(
        (token, index) => {
        variables.push({
          key: `body:${token}`,
          label: `Body ${token}`,
          component: "body",
          type: "text",
          parameterName:
            template.parameterFormat === "NAMED" ? token : undefined,
          example: exampleValue(component, "body", token, index),
        });
        },
      );
      continue;
    }
    if (componentType === "BUTTONS") {
      (component.buttons || []).forEach((button, buttonIndex) => {
        if (button.type?.toUpperCase() !== "URL") return;
        templateTextTokens(button.url, template.parameterFormat).forEach((token) => {
          variables.push({
            key: `button:${buttonIndex}:${token}`,
            label: `${button.text || `Button ${buttonIndex + 1}`} URL value`,
            component: "button",
            type: "text",
            buttonIndex,
            parameterName:
              template.parameterFormat === "NAMED" ? token : undefined,
          });
        });
      });
    }
  }
  return variables;
}

function templateBody(components: IWhatsAppTemplateComponent[]) {
  return (
    components.find((component) => component.type?.toUpperCase() === "BODY")
      ?.text || ""
  );
}

function serializeWhatsAppTemplate(
  template: IWhatsAppTemplate | Record<string, unknown>,
): WhatsAppTemplateDTO {
  const doc = template as IWhatsAppTemplate & { _id: unknown };
  return {
    _id: String(doc._id),
    name: doc.name,
    language: doc.language,
    category: doc.category,
    status: doc.status,
    parameterFormat: doc.parameterFormat,
    body: templateBody(doc.components || []),
    variables: getWhatsAppTemplateVariables(doc),
    syncedAt: new Date(doc.syncedAt).toISOString(),
  };
}

export async function syncWhatsAppTemplates(params: {
  viewer: ConversationViewer;
  connectionId: string;
}) {
  const connection = await ownedWhatsAppConnection(
    params.viewer,
    params.connectionId,
  );
  const remoteTemplates = await fetchWhatsAppTemplates(connection);
  const syncedAt = new Date();

  await WhatsAppTemplate.updateMany(
    { channelConnectionId: connection._id },
    { $set: { isActive: false, syncedAt } },
  );

  const validTemplates = remoteTemplates.filter(
    (template) =>
      Boolean(template.name?.trim()) && Boolean(template.language?.trim()),
  );
  if (validTemplates.length) {
    await WhatsAppTemplate.bulkWrite(
      validTemplates.map((template) => ({
        updateOne: {
          filter: {
            channelConnectionId: connection._id,
            name: template.name.trim(),
            language: template.language.trim(),
          },
          update: {
            $set: {
              externalTemplateId: template.id,
              category: template.category || "UNKNOWN",
              status: template.status || "UNKNOWN",
              parameterFormat:
                template.parameter_format === "NAMED"
                  ? "NAMED"
                  : "POSITIONAL",
              components: template.components || [],
              qualityScore: template.quality_score,
              isActive: true,
              syncedAt,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  const approved = await WhatsAppTemplate.find({
    channelConnectionId: connection._id,
    status: WHATSAPP_TEMPLATE_STATUSES.APPROVED,
    isActive: true,
  }).sort({ name: 1, language: 1 });
  return {
    synced: validTemplates.length,
    approved: approved.length,
    templates: approved.map(serializeWhatsAppTemplate),
  };
}

function positionalVariables(value: string, label: string) {
  const rawTokens = [...value.matchAll(/{{\s*([^{}]+)\s*}}/g)].map(
    (match) => match[1].trim(),
  );
  if (rawTokens.some((token) => !/^\d+$/.test(token))) {
    throw new ValidationError(
      `${label} supports positional variables such as {{1}} only`,
    );
  }
  const tokens = [...new Set(rawTokens.map(Number))].sort((a, b) => a - b);
  if (tokens.some((token, index) => token !== index + 1)) {
    throw new ValidationError(
      `${label} variables must be sequential, starting with {{1}}`,
    );
  }
  return tokens;
}

export async function createWhatsAppTemplate(params: {
  viewer: ConversationViewer;
  connectionId: string;
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
  const connection = await ownedWhatsAppConnection(
    params.viewer,
    params.connectionId,
  );
  const name = params.name.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new ValidationError(
      "Template name can contain lowercase letters, numbers, and underscores only",
    );
  }
  const language = params.language.trim();
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
    throw new ValidationError("Template language code is invalid");
  }
  const headerText = params.headerText?.trim() || undefined;
  const bodyText = params.bodyText.trim();
  const footerText = params.footerText?.trim() || undefined;
  if (params.category !== "AUTHENTICATION" && !bodyText) {
    throw new ValidationError("Template body is required");
  }
  if (params.category === "AUTHENTICATION" && params.button) {
    throw new ValidationError(
      "Authentication templates use Meta's required copy-code button",
    );
  }
  if (headerText && headerText.length > 60) {
    throw new ValidationError("Template header cannot exceed 60 characters");
  }
  if (bodyText.length > 1024) {
    throw new ValidationError("Template body cannot exceed 1024 characters");
  }
  if (footerText && footerText.length > 60) {
    throw new ValidationError("Template footer cannot exceed 60 characters");
  }
  const headerVariables =
    params.category === "AUTHENTICATION"
      ? []
      : positionalVariables(headerText || "", "Header");
  if (headerVariables.length > 1) {
    throw new ValidationError("Template text header supports one variable");
  }
  const bodyVariables =
    params.category === "AUTHENTICATION"
      ? []
      : positionalVariables(bodyText, "Body");
  if (
    params.category !== "AUTHENTICATION" &&
    headerVariables.length !== (params.headerExample?.trim() ? 1 : 0)
  ) {
    throw new ValidationError(
      headerVariables.length
        ? "A header variable example is required"
        : "Header example is not expected",
    );
  }
  if (
    params.category !== "AUTHENTICATION" &&
    bodyVariables.length !== params.bodyExamples.length
  ) {
    throw new ValidationError(
      `Template body requires ${bodyVariables.length} variable example${bodyVariables.length === 1 ? "" : "s"}`,
    );
  }
  const bodyExamples =
    params.category === "AUTHENTICATION"
      ? []
      : params.bodyExamples.map((value, index) => {
    const normalized = value.trim();
    if (!normalized) {
      throw new ValidationError(`Body example ${index + 1} is required`);
    }
    return normalized.slice(0, 1000);
        });
  const button = params.button
    ? {
        ...params.button,
        text: params.button.text.trim(),
        value: params.button.value?.trim() || undefined,
        example: params.button.example?.trim() || undefined,
      }
    : undefined;
  if (button?.type === "URL") {
    if (!button.value || !/^https:\/\//i.test(button.value)) {
      throw new ValidationError("Template button URL must use HTTPS");
    }
    const variables = positionalVariables(button.value, "Button URL");
    if (variables.length > 1) {
      throw new ValidationError("Template button URL supports one variable");
    }
    if (variables.length && !button.example) {
      throw new ValidationError("A variable URL button requires an example");
    }
  }
  if (
    button?.type === "PHONE_NUMBER" &&
    (!button.value || !/^\+[1-9]\d{7,14}$/.test(button.value))
  ) {
    throw new ValidationError(
      "Template phone button requires an E.164 phone number",
    );
  }

  const created = await createWhatsAppTextTemplate({
    connection,
    name,
    language,
    category: params.category,
    headerText,
    headerExample: params.headerExample?.trim() || undefined,
    bodyText,
    bodyExamples,
    footerText,
    button,
    authentication: params.authentication,
  });
  const template = await WhatsAppTemplate.findOneAndUpdate(
    {
      channelConnectionId: connection._id,
      name,
      language,
    },
    {
      $set: {
        externalTemplateId: created.id,
        category: created.category,
        status: created.status,
        parameterFormat: "POSITIONAL",
        components: created.components,
        isActive: true,
        syncedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  return serializeWhatsAppTemplate(template);
}

export async function listApprovedWhatsAppTemplates(
  connectionId: Types.ObjectId,
) {
  const templates = await WhatsAppTemplate.find({
    channelConnectionId: connectionId,
    status: WHATSAPP_TEMPLATE_STATUSES.APPROVED,
    isActive: true,
    // Authentication templates require the OTP button component, which
    // `getWhatsAppTemplateVariables` does not emit (it only handles URL
    // buttons), so a compiled send would always be rejected by Meta. Offering
    // one in the composer is a guaranteed failure — hide it until the OTP
    // component is supported end to end.
    category: { $ne: AUTHENTICATION_TEMPLATE_CATEGORY },
  }).sort({ name: 1, language: 1 });
  return templates.map(serializeWhatsAppTemplate);
}

function normalizedValue(
  variable: WhatsAppTemplateVariableDTO,
  values: Record<string, string>,
) {
  const value = values[variable.key]?.trim();
  if (!value) {
    throw new ValidationError(`${variable.label} is required`);
  }
  if (value.length > 2000) {
    throw new ValidationError(`${variable.label} is too long`);
  }
  if (variable.type !== "text") {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ValidationError(`${variable.label} must be a valid HTTPS URL`);
    }
    if (parsed.protocol !== "https:") {
      throw new ValidationError(`${variable.label} must use HTTPS`);
    }
  }
  return value;
}

export function compileWhatsAppTemplate(params: {
  template: IWhatsAppTemplate;
  values: Record<string, string>;
}) {
  const variables = getWhatsAppTemplateVariables(params.template);
  const normalized = new Map(
    variables.map((variable) => [
      variable.key,
      normalizedValue(variable, params.values),
    ]),
  );
  const sendComponents: MetaTemplateSendComponent[] = [];

  const headerVariables = variables.filter(
    (variable) => variable.component === "header",
  );
  if (headerVariables.length) {
    const media = headerVariables.find((variable) => variable.type !== "text");
    if (media) {
      const value = normalized.get(media.key)!;
      if (media.type === "image") {
        sendComponents.push({
          type: "header",
          parameters: [{ type: "image", image: { link: value } }],
        });
      } else if (media.type === "video") {
        sendComponents.push({
          type: "header",
          parameters: [{ type: "video", video: { link: value } }],
        });
      } else {
        sendComponents.push({
          type: "header",
          parameters: [{ type: "document", document: { link: value } }],
        });
      }
    } else {
      sendComponents.push({
        type: "header",
        parameters: headerVariables.map((variable) => ({
          type: "text",
          text: normalized.get(variable.key)!,
          ...(variable.parameterName
            ? { parameter_name: variable.parameterName }
            : {}),
        })),
      });
    }
  }

  const bodyVariables = variables.filter(
    (variable) => variable.component === "body",
  );
  if (bodyVariables.length) {
    sendComponents.push({
      type: "body",
      parameters: bodyVariables.map((variable) => ({
        type: "text",
        text: normalized.get(variable.key)!,
        ...(variable.parameterName
          ? { parameter_name: variable.parameterName }
          : {}),
      })),
    });
  }

  const buttonIndexes = [
    ...new Set(
      variables
        .filter((variable) => variable.component === "button")
        .map((variable) => variable.buttonIndex!),
    ),
  ];
  for (const buttonIndex of buttonIndexes) {
    const buttonVariables = variables.filter(
      (variable) =>
        variable.component === "button" &&
        variable.buttonIndex === buttonIndex,
    );
    sendComponents.push({
      type: "button",
      sub_type: "url",
      index: String(buttonIndex),
      parameters: buttonVariables.map((variable) => ({
        type: "text",
        text: normalized.get(variable.key)!,
        ...(variable.parameterName
          ? { parameter_name: variable.parameterName }
          : {}),
      })),
    });
  }

  let preview = templateBody(params.template.components || []);
  for (const variable of bodyVariables) {
    const token = variable.parameterName || variable.key.split(":")[1];
    preview = preview.replace(
      new RegExp(`{{\\s*${token}\\s*}}`, "g"),
      normalized.get(variable.key)!,
    );
  }
  preview = preview.trim() || `[WhatsApp template: ${params.template.name}]`;

  return {
    preview: preview.slice(0, 4000),
    payload: {
      name: params.template.name,
      language: params.template.language,
      components: sendComponents,
    },
  };
}

export async function getApprovedWhatsAppTemplate(params: {
  connection: IChannelConnection;
  templateId: string;
}) {
  const template = await WhatsAppTemplate.findOne({
    _id: objectId(params.templateId, "WhatsApp template"),
    channelConnectionId: params.connection._id,
    status: WHATSAPP_TEMPLATE_STATUSES.APPROVED,
    isActive: true,
  });
  if (!template) throw new NotFoundError("Approved WhatsApp template");
  return template;
}
