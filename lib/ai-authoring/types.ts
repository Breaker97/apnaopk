export const AI_AUTHORING_ENTITIES = [
  "product",
  "category",
  "collection",
  "brand",
  "blog_post",
  "content_page",
  "review",
  "review_reply",
] as const;

export const AI_AUTHORING_OPERATIONS = [
  "summary",
  "description",
  "rich_content",
  "seo",
  "image",
  "image_edit",
  "icon",
  "logo",
  "review",
  "reply",
  "tags",
  "alt_text",
  "all_text",
] as const;

export const AI_AUTHORING_MODES = ["replace", "append", "improve"] as const;
export const AI_AUTHORING_TONES = [
  "friendly",
  "professional",
  "luxury",
  "playful",
  "supportive",
] as const;
export const AI_AUTHORING_AUDIENCES = [
  "shopper",
  "merchant",
  "admin",
  "customer",
] as const;

export type AIAuthoringEntity = (typeof AI_AUTHORING_ENTITIES)[number];
type AIAuthoringOperation = (typeof AI_AUTHORING_OPERATIONS)[number];
type AIAuthoringMode = (typeof AI_AUTHORING_MODES)[number];
export type AIAuthoringTone = (typeof AI_AUTHORING_TONES)[number];
export type AIAuthoringAudience = (typeof AI_AUTHORING_AUDIENCES)[number];

export type AIAuthoringConstraints = {
  maxLength?: number;
  html?: boolean;
  tone?: AIAuthoringTone;
  audience?: AIAuthoringAudience;
};

export type AIAuthoringRequest = {
  entity: AIAuthoringEntity;
  operation: AIAuthoringOperation;
  locale: string;
  mode?: AIAuthoringMode;
  targetField?: string;
  entityId?: string;
  prompt?: string;
  /** Existing stored image URL to transform, for the "image_edit" operation. */
  sourceUrl?: string;
  fields: Record<string, unknown>;
  constraints?: AIAuthoringConstraints;
};

export type AIAuthoringSeoDraft = {
  pageTitle?: string;
  metaDescription?: string;
  handle?: string;
  slug?: string;
  tags?: string[];
};

export type AIAuthoringContentResponse = {
  fields: Record<string, string | string[]>;
  seo?: AIAuthoringSeoDraft;
  warnings?: string[];
};

export type AIAuthoringMediaOptions = {
  size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "auto" | "medium" | "high";
  outputFormat?: "png" | "jpeg" | "webp";
  background?: "auto" | "transparent" | "opaque";
};

export type AIAuthoringMediaResponse = {
  media: {
    _id: string;
    url: string;
    type: "image";
    mimeType: string;
    filename: string;
    size: number;
    alt?: string;
    width?: number;
    height?: number;
  };
  targetField?: string;
  promptUsed?: string;
  warning?: string;
};
