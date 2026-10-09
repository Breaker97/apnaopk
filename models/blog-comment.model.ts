import { mongoose } from "@/lib/db";
import type { IBlogComment } from "@/types";

const { Schema, models, model } = mongoose;

const BlogCommentSchema = new Schema<IBlogComment>(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: "BlogPost",
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "BlogComment",
      default: null,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    authorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    // Always set when a comment is written (the route requires it), and
    // removed with the IP and browser when the author deletes their account:
    // the comment stays, the means of reaching them does not.
    authorEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    authorWebsite: { type: String, trim: true },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "spam", "trash"],
      default: "pending",
      index: true,
    },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

BlogCommentSchema.index({ postId: 1, status: 1, createdAt: -1 });

if (models.BlogComment) {
  delete models.BlogComment;
}

export const BlogComment = model<IBlogComment>(
  "BlogComment",
  BlogCommentSchema,
);
