import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";

export const WHATSAPP_TEMPLATE_STATUSES = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
  IN_APPEAL: "IN_APPEAL",
  DELETED: "DELETED",
} as const;

export interface IWhatsAppTemplateComponent {
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
}

export interface IWhatsAppTemplate extends Document {
  channelConnectionId: Types.ObjectId;
  externalTemplateId?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameterFormat: "POSITIONAL" | "NAMED";
  components: IWhatsAppTemplateComponent[];
  qualityScore?: Record<string, unknown>;
  isActive: boolean;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppTemplateButtonSchema = new Schema(
  {
    type: { type: String, trim: true, maxlength: 80 },
    text: { type: String, maxlength: 1024 },
    url: { type: String, maxlength: 4000 },
    phone_number: { type: String, maxlength: 40 },
    example: { type: [String], default: undefined },
    otp_type: { type: String, maxlength: 80 },
  },
  { _id: false, strict: false },
);

const WhatsAppTemplateComponentSchema =
  new Schema<IWhatsAppTemplateComponent>(
    {
      type: { type: String, required: true, trim: true, maxlength: 80 },
      format: { type: String, trim: true, maxlength: 80 },
      text: { type: String, maxlength: 4000 },
      example: { type: Schema.Types.Mixed },
      buttons: { type: [WhatsAppTemplateButtonSchema], default: undefined },
    },
    { _id: false, strict: false },
  );

const WhatsAppTemplateSchema = new Schema<IWhatsAppTemplate>(
  {
    channelConnectionId: {
      type: Schema.Types.ObjectId,
      ref: "ChannelConnection",
      required: true,
    },
    externalTemplateId: { type: String, trim: true, maxlength: 500 },
    name: { type: String, required: true, trim: true, maxlength: 512 },
    language: { type: String, required: true, trim: true, maxlength: 40 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    status: { type: String, required: true, trim: true, maxlength: 80 },
    parameterFormat: {
      type: String,
      enum: ["POSITIONAL", "NAMED"],
      default: "POSITIONAL",
      required: true,
    },
    components: { type: [WhatsAppTemplateComponentSchema], default: [] },
    qualityScore: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true, required: true },
    syncedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

WhatsAppTemplateSchema.index(
  { channelConnectionId: 1, name: 1, language: 1 },
  { unique: true },
);
WhatsAppTemplateSchema.index({
  channelConnectionId: 1,
  status: 1,
  isActive: 1,
  name: 1,
});

export const WhatsAppTemplate: Model<IWhatsAppTemplate> =
  mongoose.models.WhatsAppTemplate ||
  mongoose.model<IWhatsAppTemplate>(
    "WhatsAppTemplate",
    WhatsAppTemplateSchema,
  );
