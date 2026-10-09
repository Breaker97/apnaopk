"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { QuickPromptCategory } from "@/components/ai-authoring/studio-presets";
import { EffectsPanel } from "@/components/ai-authoring/effects-panel";
import type {
  EffectKey,
  EffectValues,
} from "@/components/ai-authoring/studio-effects";
import type { StudioTab } from "./types";
import { useStudioStrings } from "./use-studio-strings";

/**
 * The right-hand panel body: Quick Prompt presets and the Effects sliders,
 * behind a two-tab header. Rendered in the desktop right column and reused
 * verbatim in the below-lg sheet so behavior stays identical.
 */
export function StudioSidePanelBody({
  activeTab,
  onTabChange,
  promptCategories,
  quickCategory,
  onQuickCategoryChange,
  busy,
  uploading,
  onPresetSelect,
  effects,
  effectsDisabled,
  applyingEffects,
  onEffectChange,
  onEffectsReset,
  onEffectsApply,
}: {
  activeTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  promptCategories: QuickPromptCategory[];
  quickCategory: string;
  onQuickCategoryChange: (key: string) => void;
  busy: boolean;
  uploading: boolean;
  onPresetSelect: (prompt: string) => void;
  effects: EffectValues;
  effectsDisabled: boolean;
  applyingEffects: boolean;
  onEffectChange: (key: EffectKey, value: number) => void;
  onEffectsReset: () => void;
  onEffectsApply: () => void;
}) {
  const strings = useStudioStrings();
  const activeCategory =
    promptCategories.find((category) => category.key === quickCategory) ||
    promptCategories[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[42px] shrink-0 items-stretch border-b">
        {(
          [
            { key: "quick", label: strings.tabQuickPrompt },
            { key: "effects", label: strings.tabEffects },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "flex flex-1 items-center justify-center whitespace-nowrap border-b-2 px-1 text-[13px] font-medium transition-colors",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "quick" ? (
          <div className="h-full space-y-2.5 overflow-y-auto p-4">
            <Select value={quickCategory} onValueChange={onQuickCategoryChange}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={strings.categoryPlaceholder} />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                {promptCategories.map((category) => (
                  <SelectItem key={category.key} value={category.key}>
                    {strings.presetCategoryLabel(category.key, category.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-2.5">
              {activeCategory.prompts.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => onPresetSelect(preset.prompt)}
                  className="flex h-11 shrink-0 items-center gap-2.5 rounded-[8px] border px-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="h-[34px] w-[34px] shrink-0 rounded-[6px] bg-muted-foreground/15" />
                  <span className="truncate text-sm">
                    {strings.presetLabel(preset.key, preset.label)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EffectsPanel
            values={effects}
            disabled={effectsDisabled}
            applying={applyingEffects}
            onChange={onEffectChange}
            onReset={onEffectsReset}
            onApply={onEffectsApply}
          />
        )}
      </div>
    </div>
  );
}
