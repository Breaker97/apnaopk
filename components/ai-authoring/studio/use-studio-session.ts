"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast-notification";
import type { QuickPromptCategory } from "@/components/ai-authoring/studio-presets";
import {
  clearStudioDraft,
  loadStudioDraft,
  saveStudioDraft,
} from "@/components/ai-authoring/studio-drafts";
import { appendVersion, stepHistoryIndex } from "./session-model";
import {
  SCRATCH_KEY,
  type StudioImage,
  type StudioSession,
  type StudioTab,
  type StudioVersion,
} from "./types";
import { useStudioStrings } from "./use-studio-strings";

/**
 * The studio's draft-persisted working state: per-image version histories,
 * the selected image, and the prompt-panel state (prompt text, active tab,
 * quick-prompt category) — exactly the slice mirrored to localStorage so a
 * page reload can restore unsaved work.
 *
 * Everything else (canvas view, busy flags, panel visibility) is deliberately
 * not here: losing it on reload is fine, so it must not gate the autosave.
 */
export function useStudioSession({
  open,
  images,
  initialMediaId,
  persistKey,
  promptCategories,
}: {
  open: boolean;
  images: StudioImage[];
  initialMediaId?: string | null;
  persistKey?: string;
  promptCategories: QuickPromptCategory[];
}) {
  const strings = useStudioStrings();
  const [sessions, setSessions] = useState<Record<string, StudioSession>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<StudioTab>("quick");
  const [quickCategory, setQuickCategory] = useState(promptCategories[0].key);

  // Suppresses the autosave write triggered by the restore/reset on open, so it
  // can't immediately overwrite the draft it just loaded.
  const hydratingRef = useRef(false);
  // Tracks the previous `open` so an intentional close (not a reload) can clear
  // the draft.
  const wasOpenRef = useRef(false);

  // Reset the session slice each time the studio opens — or, if a reload left
  // an autosaved draft behind, resume from it instead of starting fresh.
  useEffect(() => {
    if (!open) return;
    hydratingRef.current = true;

    const draft = loadStudioDraft(persistKey);
    if (draft && Object.keys(draft.sessions).length > 0) {
      // Restoring reads localStorage and toasts, so it is effect work by
      // nature; it runs once per open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions(draft.sessions);
      setSelectedKey(draft.selectedKey);
      setPrompt(draft.prompt ?? "");
      setActiveTab(draft.activeTab === "effects" ? "effects" : "quick");
      setQuickCategory(
        promptCategories.some((c) => c.key === draft.quickCategory)
          ? draft.quickCategory
          : promptCategories[0].key,
      );
      toast.success(strings.restoredDraft);
    } else {
      const initial =
        (initialMediaId && images.find((img) => img._id === initialMediaId)) ||
        images[0] ||
        null;
      setSessions(
        initial
          ? {
              [initial._id]: {
                versions: [{ url: initial.url, response: null }],
                index: 0,
              },
            }
          : {},
      );
      setSelectedKey(initial?._id ?? null);
      setPrompt("");
      setActiveTab("quick");
      setQuickCategory(promptCategories[0].key);
    }
    // Snapshot of images/initialMediaId is intentional — reset only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentSession = selectedKey ? sessions[selectedKey] : undefined;
  const currentVersion = currentSession
    ? currentSession.versions[currentSession.index]
    : undefined;
  const originalUrl = currentSession?.versions[0]?.url;
  const currentUrl = currentVersion?.url ?? null;
  const canCompare = !!currentSession && currentSession.index > 0;

  const scratchSession = sessions[SCRATCH_KEY];
  const scratchUrl = scratchSession
    ? scratchSession.versions[scratchSession.index]?.url
    : null;

  const hasAnyEdits = useMemo(
    () =>
      Object.values(sessions).some(
        (session) =>
          session.versions.length > 1 ||
          session.versions.some((version) => version.response),
      ),
    [sessions],
  );

  // Autosave the working draft (prompt + edited/generated versions) so a page
  // reload can resume it. The `hydratingRef` guard skips the write caused by
  // the restore/reset on open, so it never clobbers the draft it just loaded.
  useEffect(() => {
    if (!open || !persistKey) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    if (hasAnyEdits || prompt.trim().length > 0) {
      saveStudioDraft(persistKey, {
        sessions,
        selectedKey,
        prompt,
        activeTab,
        quickCategory,
      });
    } else {
      // Nothing worth keeping — don't leave a stale draft to restore later.
      clearStudioDraft(persistKey);
    }
  }, [
    open,
    persistKey,
    sessions,
    selectedKey,
    prompt,
    activeTab,
    quickCategory,
    hasAnyEdits,
  ]);

  // Clear the draft when the studio is closed intentionally (Save / Cancel /
  // Discard). A page reload tears the component down without this false
  // transition, so the draft survives a reload and restores on the next open.
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      clearStudioDraft(persistKey);
    }
    wasOpenRef.current = open;
  }, [open, persistKey]);

  /** Select an image, lazily creating its session on first selection. */
  const selectKey = useCallback((key: string, url: string) => {
    setSessions((prev) =>
      prev[key]
        ? prev
        : {
            ...prev,
            [key]: { versions: [{ url, response: null }], index: 0 },
          },
    );
    setSelectedKey(key);
  }, []);

  const pushVersion = (key: string, version: StudioVersion) => {
    setSessions((prev) => {
      const session = prev[key];
      if (!session) return prev;
      return { ...prev, [key]: appendVersion(session, version) };
    });
  };

  /** Append to (or create) the scratch session and select it. */
  const pushScratchVersion = (version: StudioVersion) => {
    setSessions((prev) => {
      const existing = prev[SCRATCH_KEY];
      if (!existing) {
        return { ...prev, [SCRATCH_KEY]: { versions: [version], index: 0 } };
      }
      return { ...prev, [SCRATCH_KEY]: appendVersion(existing, version) };
    });
    setSelectedKey(SCRATCH_KEY);
  };

  /** Drop a session entry. Reselection is the caller's concern. */
  const dropSession = (key: string) => {
    setSessions((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const stepHistory = useCallback(
    (delta: number) => {
      if (!selectedKey) return;
      setSessions((prev) => {
        const session = prev[selectedKey];
        if (!session) return prev;
        const index = stepHistoryIndex(session, delta);
        if (index === session.index) return prev;
        return { ...prev, [selectedKey]: { ...session, index } };
      });
    },
    [selectedKey],
  );

  return {
    sessions,
    selectedKey,
    setSelectedKey,
    prompt,
    setPrompt,
    activeTab,
    setActiveTab,
    quickCategory,
    setQuickCategory,
    currentSession,
    currentVersion,
    originalUrl,
    currentUrl,
    canCompare,
    scratchSession,
    scratchUrl,
    hasAnyEdits,
    selectKey,
    pushVersion,
    pushScratchVersion,
    dropSession,
    stepHistory,
  };
}

export type StudioSessionApi = ReturnType<typeof useStudioSession>;
