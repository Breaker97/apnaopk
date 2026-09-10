import { mongoose } from "@/lib/db";
import type { IBlogPost } from "@/types";

const { Schema, models, model } = mongoose;

const BlogPostSchema = new Schema<IBlogPost>(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    excerpt: {
      type: String,
      maxlength: [500, "Excerpt cannot exceed 500 characters"],
    },
    content: {
      type: String,
      required: [true, "Content is required"],
    },
    featuredImage: {
      url: { type: String },
      alt: { type: String },
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorName: {
      type: String,
    },
    categoryIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "BlogCategory",
      },
    ],
    tags: [{ type: String, trim: true, lowercase: true }],
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "archived"],
      default: "draft",
    },
    visibility: {
      type: String,
      enum: ["public", "private", "password"],
      default: "public",
    },
    password: { type: String },
    publishedAt: { type: Date, index: true },
    scheduledFor: { type: Date },
    allowComments: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false, index: true },
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    readingTime: { type: Number, default: 0 },
    seo: {
      pageTitle: { type: String, maxlength: 70 },
      metaDescription: { type: String, maxlength: 320 },
      ogImage: { type: String },
      canonicalUrl: { type: String },
      noIndex: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BlogPostSchema.index({ status: 1, publishedAt: -1 });
BlogPostSchema.index({ tags: 1 });
BlogPostSchema.index({ title: "text", content: "text", excerpt: "text" });

BlogPostSchema.virtual("author", {
  ref: "User",
  localField: "authorId",
  foreignField: "_id",
  justOne: true,
});

BlogPostSchema.virtual("categories", {
  ref: "BlogCategory",
  localField: "categoryIds",
  foreignField: "_id",
});

if (models.BlogPost) {
  delete models.BlogPost;
}

export const BlogPost = model<IBlogPost>("BlogPost", BlogPostSchema);
