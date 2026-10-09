import mongoose, {
  Schema,
  type Document,
  type Model,
} from "mongoose";

type LiveChatAvailabilityMode = "always" | "business_hours";

export interface IBusinessHour {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

interface IPlatformMessagingSettings extends Document {
  liveChatEnabled: boolean;
  availabilityMode: LiveChatAvailabilityMode;
  timezone: string;
  businessHours: IBusinessHour[];
  primaryColor: string;
  offlineMessage: string;
  escalationEnabled: boolean;
  escalationAfterMinutes: number;
  escalationEmail?: string;
  updatedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_BUSINESS_HOURS: IBusinessHour[] = Array.from(
  { length: 7 },
  (_, day) => ({
    day,
    enabled: day >= 1 && day <= 5,
    start: "09:00",
    end: "17:00",
  }),
);

const BusinessHourSchema = new Schema<IBusinessHour>(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    enabled: { type: Boolean, default: false },
    start: {
      type: String,
      default: "09:00",
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    end: {
      type: String,
      default: "17:00",
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
  },
  { _id: false },
);

const PlatformMessagingSettingsSchema =
  new Schema<IPlatformMessagingSettings>(
    {
      liveChatEnabled: { type: Boolean, default: true },
      availabilityMode: {
        type: String,
        enum: ["always", "business_hours"],
        default: "always",
      },
      timezone: { type: String, default: "Asia/Dhaka", maxlength: 100 },
      businessHours: {
        type: [BusinessHourSchema],
        default: () => DEFAULT_BUSINESS_HOURS,
      },
      primaryColor: {
        type: String,
        default: "#2563eb",
        match: /^#[0-9a-fA-F]{6}$/,
      },
      offlineMessage: {
        type: String,
        default:
          "Our team is currently offline. Leave a message and we will reply as soon as possible.",
        maxlength: 500,
      },
      escalationEnabled: { type: Boolean, default: false },
      escalationAfterMinutes: {
        type: Number,
        default: 15,
        min: 5,
        max: 1440,
      },
      escalationEmail: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 320,
      },
      updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  );

export const PlatformMessagingSettings: Model<IPlatformMessagingSettings> =
  mongoose.models.PlatformMessagingSettings ||
  mongoose.model<IPlatformMessagingSettings>(
    "PlatformMessagingSettings",
    PlatformMessagingSettingsSchema,
  );

export { DEFAULT_BUSINESS_HOURS };
