"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AppImage } from "@/components/ui/app-image";
import { ExternalLink, Pencil, Plus, X } from "lucide-react";
import { useAppSettings } from "@/providers/app-settings-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeoChecklist } from "@/components/admin/seo-checklist";
import { escapeRegExp } from "@/lib/strings";

const DEFAULT_PREVIEW_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type HandleFeedbackTone = "default" | "success" | "error";

interface SearchEngineListingPreviewProps {
  pageTitle: string;
  metaDescription: string;
  handle: string;
  title?: string;
  description?: string;
  entityLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyHandle?: string;
  storeName?: string;
  baseUrl?: string;
  pathPrefix?: string | string[];
  titlePlaceholder?: string;
  metaDescriptionPlaceholder?: string;
  handlePlaceholder?: string;
  tags?: string[];
  tagsPlaceholder?: string;
  titleMaxChars?: number;
  descriptionMaxChars?: number;
  helperText?: ReactNode;
  aiGenerateAction?: ReactNode;
  pageTitleAction?: ReactNode;
  metaDescriptionAction?: ReactNode;
  handleFeedback?: ReactNode;
  handleFeedbackTone?: HandleFeedbackTone;
  defaultEditing?: boolean;
  onPageTitleChange: (value: string) => void;
  onMetaDescriptionChange: (value: string) => void;
  onHandleChange: (value: string) => void;
  onTagsChange?: (value: string[]) => void;
}

export function generateSearchHandle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);
}

export function sanitizeSearchHandle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.substring(0, maxLength - 3)}...`;
}

function capitalize(value: string): string {
  if (!value) return "Page";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizePathSegments(pathPrefix: string | string[] = "products") {
  const segments = Array.isArray(pathPrefix)
    ? pathPrefix
    : pathPrefix.split("/");

  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function buildUrl(baseUrl: string, segments: string[]) {
  return [baseUrl.replace(/\/+$/g, ""), ...segments].filter(Boolean).join("/");
}

export function SearchEngineListingPreview({
  pageTitle,
  metaDescription,
  handle,
  title = "",
  description = "",
  entityLabel = "page",
  emptyTitle,
  emptyDescription = "No description available.",
  emptyHandle,
  storeName,
  baseUrl,
  pathPrefix = "products",
  titlePlaceholder,
  metaDescriptionPlaceholder,
  handlePlaceholder,
  tags,
  tagsPlaceholder = "Add a tag and press Enter",
  titleMaxChars = 70,
  descriptionMaxChars = 160,
  helperText,
  aiGenerateAction,
  pageTitleAction,
  metaDescriptionAction,
  handleFeedback,
  handleFeedbackTone = "default",
  defaultEditing = false,
  onPageTitleChange,
  onMetaDescriptionChange,
  onHandleChange,
  onTagsChange,
}: SearchEngineListingPreviewProps) {
  const { storeName: configuredStoreName, faviconUrl } = useAppSettings();
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [previewBaseUrl, setPreviewBaseUrl] = useState(
    DEFAULT_PREVIEW_BASE_URL,
  );
  const [failedFaviconSrc, setFailedFaviconSrc] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const hasHydratedEditDefaultsRef = useRef(false);
  const hasManualHandleEditRef = useRef(false);
  const previousGeneratedHandleRef = useRef("");
  const id = useId();

  useEffect(() => {
    if (baseUrl) return;

    const timer = window.setTimeout(() => {
      setPreviewBaseUrl(window.location.origin);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [baseUrl]);

  const pathSegments = useMemo(
    () => normalizePathSegments(pathPrefix),
    [pathPrefix],
  );
  const strippedDescription = useMemo(
    () => stripHtml(description),
    [description],
  );
  const generatedHandle = generateSearchHandle(title);
  const fallbackHandle =
    generatedHandle ||
    emptyHandle ||
    `${generateSearchHandle(entityLabel) || "page"}-handle`;
  const displayHandle = handle || fallbackHandle;
  const displayTitle =
    pageTitle || title || emptyTitle || `Untitled ${capitalize(entityLabel)}`;
  const displayDescription =
    metaDescription || strippedDescription || emptyDescription;
  const listingSegments = [...pathSegments, displayHandle];
  const resolvedBaseUrl = baseUrl || previewBaseUrl;
  // Mirrors the real listing: with no favicon configured there is no icon to
  // show, so the preview falls through to the store-initial badge below.
  const faviconSrc = faviconUrl?.trim() || "";
  const faviconFailed = !faviconSrc || failedFaviconSrc === faviconSrc;
  const fullUrl = buildUrl(resolvedBaseUrl, listingSegments);
  const breadcrumbUrl = [
    resolvedBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/g, ""),
    ...listingSegments,
  ].join(" › ");
  const prefixLabel = pathSegments.length ? `${pathSegments.join("/")}/` : "";
  const resolvedStoreName = storeName || configuredStoreName || "Your Store";
  const resolvedHelperText =
    helperText || "Showing auto-filled values from title & excerpt.";
  const previewBadgeLabel =
    resolvedStoreName.trim().charAt(0).toUpperCase() ||
    capitalize(entityLabel).charAt(0);
  const showTagsInput = Array.isArray(tags) && Boolean(onTagsChange);

  const addTag = () => {
    if (!showTagsInput || !onTagsChange) return;
    const next = tagInput.trim().toLowerCase();
    if (!next) return;
    if (!tags.includes(next)) {
      onTagsChange([...tags, next]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    if (!showTagsInput || !onTagsChange) return;
    onTagsChange(tags.filter((item) => item !== tag));
  };

  useEffect(() => {
    if (!isEditing || hasHydratedEditDefaultsRef.current) return;

    if (!pageTitle.trim() && title.trim()) {
      onPageTitleChange(title);
    }

    if (!metaDescription.trim() && strippedDescription) {
      onMetaDescriptionChange(strippedDescription);
    }

    if (!handle.trim() && generatedHandle) {
      onHandleChange(generatedHandle);
    }

    hasHydratedEditDefaultsRef.current = true;
  }, [
    generatedHandle,
    handle,
    isEditing,
    metaDescription,
    onHandleChange,
    onMetaDescriptionChange,
    onPageTitleChange,
    pageTitle,
    strippedDescription,
    title,
  ]);

  useEffect(() => {
    if (!isEditing || !generatedHandle || hasManualHandleEditRef.current) {
      previousGeneratedHandleRef.current = generatedHandle;
      return;
    }

    const currentHandle = handle.trim();
    const previousGeneratedHandle = previousGeneratedHandleRef.current;
    const shouldSyncHandle =
      !currentHandle ||
      currentHandle === previousGeneratedHandle ||
      isPlaceholderHandle(currentHandle, entityLabel, emptyHandle);

    if (shouldSyncHandle && currentHandle !== generatedHandle) {
      onHandleChange(generatedHandle);
    }

    previousGeneratedHandleRef.current = generatedHandle;
  }, [
    emptyHandle,
    entityLabel,
    generatedHandle,
    handle,
    isEditing,
    onHandleChange,
  ]);

  const titleInputId = `${id}-title`;
  const descriptionInputId = `${id}-description`;
  const handleInputId = `${id}-handle`;

  return (
    <Card className="gap-4 overflow-hidden border-border">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b border-border bg-muted/20 px-5">
        <div className="space-y-1">
          <CardTitle>Search Engine Listing</CardTitle>
          <p className="text-sm text-muted-foreground">
            Auto-filled from title &amp; excerpt. Customize to override.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiGenerateAction}
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setIsEditing((current) => !current)}
            className="rounded-[6px] border-border px-4 text-[12px] text-muted-foreground hover:bg-muted"
            aria-label={
              isEditing
                ? "Hide search engine listing editor"
                : "Edit search engine listing"
            }
          >
            <Pencil className="h-3 w-3" />
            {isEditing ? "Hide SEO" : "Edit SEO"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <div className="rounded-sm border border-border bg-background p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {!faviconFailed ? (
                <AppImage
                  key={faviconSrc}
                  src={faviconSrc}
                  alt={`${resolvedStoreName} favicon`}
                  className="h-5 w-5 rounded-full border border-border object-cover"
                  height={24}
                  width={24}
                  onImageError={() => setFailedFaviconSrc(faviconSrc)}
                />
              ) : (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-700 text-[10px] font-semibold text-white">
                  {previewBadgeLabel}
                </span>
              )}
              <p className="truncate text-sm font-semibold leading-none text-foreground">
                {truncateText(resolvedStoreName, 80)}
              </p>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {breadcrumbUrl}
            </p>
            <h3 className="cursor-pointer truncate text-lg font-medium leading-tight text-[#1a0dab] hover:underline dark:text-[#8ab4f8]">
              {truncateText(displayTitle, 60)}
            </h3>
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {truncateText(displayDescription, 160)}
            </p>
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-4 border-t border-border pt-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={titleInputId}>Page title</Label>
                {pageTitleAction}
              </div>
              <Input
                id={titleInputId}
                value={pageTitle}
                maxLength={titleMaxChars}
                onChange={(event) =>
                  onPageTitleChange(event.target.value.slice(0, titleMaxChars))
                }
                placeholder={titlePlaceholder || title || "Enter page title"}
              />
              <p className="text-xs text-muted-foreground">
                {pageTitle.length}/{titleMaxChars}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={descriptionInputId}>Meta description</Label>
                {metaDescriptionAction}
              </div>
              <Textarea
                id={descriptionInputId}
                value={metaDescription}
                maxLength={descriptionMaxChars}
                onChange={(event) =>
                  onMetaDescriptionChange(
                    event.target.value.slice(0, descriptionMaxChars),
                  )
                }
                placeholder={
                  metaDescriptionPlaceholder ||
                  strippedDescription ||
                  "Enter meta description for search engines"
                }
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {metaDescription.length}/{descriptionMaxChars}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={handleInputId}>URL handle</Label>
              <div className="flex items-center">
                {prefixLabel ? (
                  <span className="mr-1 whitespace-nowrap text-sm text-muted-foreground">
                    {prefixLabel}
                  </span>
                ) : null}
                <Input
                  id={handleInputId}
                  value={handle}
                  onChange={(event) => {
                    hasManualHandleEditRef.current = true;
                    onHandleChange(sanitizeSearchHandle(event.target.value));
                  }}
                  placeholder={handlePlaceholder || fallbackHandle}
                  className="min-w-0 flex-1"
                />
              </div>
              {handleFeedback ? (
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    handleFeedbackTone === "success" &&
                      "text-emerald-600 dark:text-emerald-400",
                    handleFeedbackTone === "error" &&
                      "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {handleFeedback}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{fullUrl}</p>
            </div>

            {showTagsInput ? (
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                    onBlur={addTag}
                    placeholder={tagsPlaceholder}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={addTag}
                    aria-label="Add SEO tag"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          aria-label={`Remove ${tag}`}
                          className="inline-flex rounded-sm text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
            {resolvedHelperText}
          </p>
        )}

        <SeoChecklist
          pageTitle={pageTitle}
          metaDescription={metaDescription}
          handle={handle}
          title={title}
          description={description}
          tags={tags}
          titleMaxChars={titleMaxChars}
          descriptionMaxChars={descriptionMaxChars}
        />
      </CardContent>
    </Card>
  );
}

function isPlaceholderHandle(
  handle: string,
  entityLabel: string,
  emptyHandle?: string,
) {
  const fallbackHandle =
    emptyHandle || `${generateSearchHandle(entityLabel) || "page"}-handle`;
  return (
    handle === fallbackHandle ||
    new RegExp(`^${escapeRegExp(fallbackHandle)}-\\d+$`).test(handle)
  );
}

