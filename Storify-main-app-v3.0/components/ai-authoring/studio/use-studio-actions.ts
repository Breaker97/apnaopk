"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast-notification";
import type {
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "@/lib/ai-authoring/types";
import {
  uploadImageFile,
  type UploadedImage,
} from "@/components/ai-authoring/upload-image";
import {
  STUDIO_TOOL_PROMPTS,
  type StudioSizeOption,
} from "@/components/ai-authoring/studio-presets";
import { renderExpandCompositeToBlob } from "@/components/ai-authoring/studio-effects";
import type { StudioVersion } from "./types";
import type { StudioSessionApi } from "./use-studio-session";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * The studio's AI operations and uploads: every generation goes through the
 * ai-authoring media endpoint via the `onGenerate` prop, and every result is
 * appended to the selected image's version history. `busy` is the operation
 * label shown on the stage overlay; only one operation runs at a time.
 */
export function useStudioActions({
  open,
  editRequest,
  generateRequest,
  generateDefaults,
  onGenerate,
  postProcessResult,
  onUpload,
  session,
  onVersionShown,
  onSelectImage,
}: {
  open: boolean;
  editRequest: AIAuthoringRequest;
  generateRequest: AIAuthoringRequest;
  generateDefaults?: AIAuthoringMediaOptions;
  onGenerate: (
    request: AIAuthoringRequest,
    options: AIAuthoringMediaOptions,
  ) => Promise<AIAuthoringMediaResponse | null>;
  /**
   * Transform a fresh generation/edit result before it becomes a version — e.g.
   * a ratio-locked surface crops the result and re-uploads it so the on-stage
   * image and the saved image are already at the surface's exact ratio. Runs for
   * both from-scratch and edit results; a throw surfaces as an operation error.
   */
  postProcessResult?: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
  onUpload: (media: UploadedImage) => void;
  session: Pick<
    StudioSessionApi,
    | "currentVersion"
    | "selectedKey"
    | "pushVersion"
    | "pushScratchVersion"
    | "setPrompt"
  >;
  /** Leave compare/peek after a new version lands on the stage. */
  onVersionShown: () => void;
  /** Full image selection (session + view/tool resets), for post-upload select. */
  onSelectImage: (key: string, url: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // An async result must not mutate state after the studio closed mid-flight.
  const openRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    openRef.current = true;
    return () => {
      openRef.current = false;
    };
  }, [open]);
  useApplyOnChange([open], () => {
    if (!open) return;
    setBusy(null);
    setUploading(false);
  });

  const { currentVersion, selectedKey } = session;
  const toolsDisabled = !currentVersion || !!busy || uploading;

  const runEdit = async (
    instruction: string,
    options: AIAuthoringMediaOptions,
    label: string,
    sourceUrlOverride?: string,
  ): Promise<AIAuthoringMediaResponse | null> => {
    if (!currentVersion || !selectedKey || busy || uploading) return null;
    const key = selectedKey;
    setBusy(label);
    try {
      const response = await onGenerate(
        {
          ...editRequest,
          operation: "image_edit",
          sourceUrl: sourceUrlOverride ?? currentVersion.url,
          prompt: instruction,
        },
        {
          // Quality is deliberately not set here: the server fills it from
          // Settings → AI image defaults, so admins can actually cap cost.
          size: "auto",
          outputFormat: "png",
          background: "auto",
          ...options,
        },
      );
      if (response && openRef.current) {
        const finalResponse = postProcessResult
          ? await postProcessResult(response)
          : response;
        if (!openRef.current) return finalResponse;
        session.pushVersion(key, {
          url: finalResponse.media.url,
          response: finalResponse,
          transparent: options.background === "transparent",
        });
        onVersionShown();
        return finalResponse;
      }
      return response;
    } finally {
      setBusy(null);
    }
  };

  const runGenerateFromScratch = async (text: string) => {
    if (busy || uploading) return;
    setBusy("Generating image…");
    try {
      const options: AIAuthoringMediaOptions = {
        // Quality intentionally omitted — the server applies the admin's
        // Settings → AI default so cost control actually works.
        size: "1024x1024",
        outputFormat: "png",
        background: "auto",
        ...generateDefaults,
      };
      const response = await onGenerate(
        { ...generateRequest, operation: "image", prompt: text },
        options,
      );
      if (response && openRef.current) {
        const finalResponse = postProcessResult
          ? await postProcessResult(response)
          : response;
        if (!openRef.current) return;
        // Mirror runEdit: a transparent result needs the checkerboard, or it
        // reads as an opaque white background on the artboard.
        const version: StudioVersion = {
          url: finalResponse.media.url,
          response: finalResponse,
          transparent: options.background === "transparent",
        };
        session.pushScratchVersion(version);
        session.setPrompt("");
      }
    } finally {
      setBusy(null);
    }
  };

  const runRemoveBackground = () =>
    runEdit(
      STUDIO_TOOL_PROMPTS.removeBackground,
      { background: "transparent" },
      "Removing background…",
    );
  const runEnhance = () =>
    runEdit(STUDIO_TOOL_PROMPTS.enhance, {}, "Enhancing image…");
  const runUpscale = () =>
    runEdit(STUDIO_TOOL_PROMPTS.upscale, {}, "Upscaling image…");
  const runResize = (option: StudioSizeOption) =>
    runEdit(
      STUDIO_TOOL_PROMPTS.resize(option),
      { size: option.size },
      "Resizing canvas…",
    );
  const runExpand = async (option: StudioSizeOption) => {
    if (toolsDisabled) return;
    const source = currentVersion;
    if (!source) return;
    // Genuine outpaint: place the current image, smaller and centered, on a
    // transparent canvas at the target ratio, upload that, then have the model
    // fill only the new margins. This is what makes Expand differ from Resize.
    setBusy("Preparing expand…");
    let compositeUrl: string | null = null;
    try {
      const blob = await renderExpandCompositeToBlob(source.url, option.size);
      const file = new File([blob], "expand-canvas.png", {
        type: "image/png",
      });
      const media = await uploadImageFile(file);
      compositeUrl = media.url;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not prepare the expand canvas",
      );
    } finally {
      setBusy(null);
    }
    if (!compositeUrl || !openRef.current) return;
    await runEdit(
      STUDIO_TOOL_PROMPTS.expand(option),
      { size: option.size, background: "opaque" },
      "Expanding image…",
      compositeUrl,
    );
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (list.length === 0) {
      toast.error("Please choose image files");
      return;
    }
    setUploading(true);
    try {
      let last: UploadedImage | null = null;
      for (const file of list) {
        try {
          const media = await uploadImageFile(file);
          onUpload(media);
          last = media;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Upload failed");
        }
      }
      if (last && openRef.current) onSelectImage(last._id, last.url);
    } finally {
      setUploading(false);
    }
  };

  return {
    busy,
    uploading,
    openRef,
    toolsDisabled,
    runEdit,
    runGenerateFromScratch,
    runRemoveBackground,
    runEnhance,
    runUpscale,
    runResize,
    runExpand,
    handleUploadFiles,
  };
}

