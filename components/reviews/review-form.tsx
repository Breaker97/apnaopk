"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InteractiveStarRating } from "./star-rating";
import { toast } from "@/components/ui/toast-notification";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";

interface ReviewFormProps {
  productId: string;
  orderId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ReviewForm({
  productId,
  orderId,
  onSuccess,
  onCancel,
}: ReviewFormProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);

  const tf = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    if (t.has(key)) {
      return t(key as never, values as never);
    }
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token) =>
      String(values[token] ?? `{${token}}`),
    );
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const uploadSingleImage = async (file: File): Promise<string> => {
    if (!file.type.startsWith("image/")) {
      throw new Error(tf("reviews.invalidImage", "Only image files are allowed"));
    }

    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new Error(tf("reviews.imageTooLarge", "Each image must be less than 10MB"));
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "review");

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || tf("reviews.imageUploadFailed", "Image upload failed"));
    }

    const url = Array.isArray(data?.data) ? data.data?.[0]?.url : data?.url;
    if (!url) {
      throw new Error(tf("reviews.imageUploadFailed", "Image upload failed"));
    }

    return url;
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await handleImageFiles(files);
  };

  const handleImageFiles = async (files: File[]) => {
    if (!files.length) return;

    const maxImages = 4;
    if (images.length >= maxImages) {
      toast.error(tf("reviews.maxImages", "You can upload up to 4 images"));
      return;
    }

    const slotsLeft = maxImages - images.length;
    const selected = files.slice(0, slotsLeft);

    setIsUploadingImages(true);
    try {
      const uploadedUrls = await Promise.all(selected.map(uploadSingleImage));
      setImages((prev) => [...prev, ...uploadedUrls]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tf("common.error", "Something went wrong");
      toast.error(message);
    } finally {
      setIsUploadingImages(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitInFlightRef.current) return;

    if (rating === 0) {
      toast.error(tf("reviews.selectRating", "Please select a rating"));
      return;
    }

    if (comment.length < 10) {
      toast.error(
        tf("reviews.commentTooShort", "Comment must be at least 10 characters"),
      );
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          orderId,
          rating,
          title,
          comment,
          images,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || tf("reviews.submitFailed", "Failed to submit review"));
      }

      toast.success(tf("reviews.submitted", "Review submitted successfully!"));
      onSuccess?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tf("common.error", "Something went wrong");
      toast.error(message);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{tf("reviews.yourRating", "Your Rating")}</Label>
        <InteractiveStarRating value={rating} onChange={setRating} size="md" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">
          {tf("reviews.title", "Title")} ({tf("common.optional", "optional")})
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tf("reviews.titlePlaceholder", "Sum up your review")}
          maxLength={100}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="comment">{tf("reviews.comment", "Your review *")}</Label>
        <Textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={tf("reviews.commentPlaceholder", "Share your experience with this product")}
          rows={5}
          maxLength={1000}
        />
        <p className="text-xs text-muted-foreground">{comment.length}/1000</p>
      </div>

      <div className="space-y-2 rounded-md border border-border/80 px-4 py-3">
        <Label htmlFor="comment">
          {tf("reviews.photos", "Images")} ({tf("common.optional", "optional")})
        </Label>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageChange}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!isUploadingImages && images.length < 4) {
              setIsDragOver(true);
            }
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (isUploadingImages || images.length >= 4) return;
            const dropped = Array.from(e.dataTransfer.files || []);
            await handleImageFiles(dropped);
          }}
          disabled={isUploadingImages || images.length >= 4}
          className={cn(
            "w-full rounded-md border-2 border-dashed px-4 py-4 text-center transition-colors",
            isDragOver
              ? "border-foreground/45 bg-muted/30"
              : "border-border bg-muted/20",
            (isUploadingImages || images.length >= 4) && "cursor-not-allowed opacity-65",
          )}
        >
          <div className="mx-auto flex max-w-lg flex-col items-center gap-2 text-center">
            {isUploadingImages ? (
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
            <p className="text-sm text-foreground">
              {tf(
                "reviews.dropzonePrimary",
                "Drag and drop files here, or click to browse",
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {tf(
                "reviews.dropzoneHint",
                "Supports images up to 10MB each.",
              )}
            </p>
          </div>
        </button>

        <p className="text-xs text-muted-foreground">
          {images.length} / 4 {tf("common.files", "files")}
        </p>

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((src) => (
              <div
                key={src}
                className="relative h-20 w-20 overflow-hidden rounded-sm border bg-muted sm:h-20 sm:w-20"
              >
                <div className="relative h-full w-full">
                  <AppImage src={src} alt="Review" fill className="object-cover" />
                </div>
                <button
                  type="button"
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground"
                  onClick={() => setImages((prev) => prev.filter((u) => u !== src))}
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {tf("common.cancel", "Cancel")}
          </Button>
        )}
        <Button type="submit" className="rounded-full px-6" disabled={isSubmitting || isUploadingImages}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {tf("reviews.submit", "Submit review")}
        </Button>
      </div>
    </form>
  );
}
