/**
 * Push Ticket Model
 *
 * A native push Expo accepted, waiting for its receipt. Expo's answer to a
 * send only says it took the message; whether Apple or Google delivered it,
 * or said the app is gone (DeviceNotRegistered), comes later, by ticket id.
 * `processPushReceipts` (lib/notifications/push-notifications.ts) reads the
 * receipts of tickets at least 15 minutes old and deletes each one answered.
 * Expo keeps a receipt for a day, so does this: an unanswered ticket expires.
 */

import mongoose, { Schema, Model } from "mongoose";

interface IPushTicket {
  ticketId: string;
  deviceToken: string;
  createdAt: Date;
}

const PushTicketSchema = new Schema<IPushTicket>(
  {
    ticketId: { type: String, required: true },
    deviceToken: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The receipt sweep's range scan, and the day after which a receipt is gone.
PushTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const PushTicket: Model<IPushTicket> =
  mongoose.models.PushTicket ||
  mongoose.model<IPushTicket>("PushTicket", PushTicketSchema);
