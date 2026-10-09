"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_SOCIAL_PROFILES,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_PLACEHOLDERS,
  type SocialPlatform,
  type SocialProfile,
} from "@/lib/site-config/social-profiles";

interface VendorSocialProfilesEditorLabels {
  platform: string;
  url: string;
  customLabel: string;
  customLabelPlaceholder: string;
  add: string;
  remove: string;
  empty: string;
  limitReached: string;
}

interface VendorSocialProfilesEditorProps {
  value: SocialProfile[];
  onChange: (next: SocialProfile[]) => void;
  labels: VendorSocialProfilesEditorLabels;
  disabled?: boolean;
}

/**
 * Repeatable editor for the vendor's own social profiles.
 *
 * A list rather than fixed platform fields, so a seller publishes the platforms
 * that actually matter to them — Instagram and TikTok for one store, LinkedIn for
 * another — and `Other` covers anything not on the list without the shape having
 * to grow.
 *
 * Rows are keyed by a locally-generated id rather than by array index, so
 * deleting a middle row does not make React reuse the wrong input state.
 */
export function VendorSocialProfilesEditor({
  value,
  onChange,
  labels,
  disabled = false,
}: VendorSocialProfilesEditorProps) {
  const atLimit = value.length >= MAX_SOCIAL_PROFILES;

  const update = (id: string, patch: Partial<SocialProfile>) => {
    onChange(
      value.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const add = () => {
    if (atLimit) return;
    // Unique against the current rows rather than a running counter, so removing
    // and re-adding cannot collide with an existing id.
    const used = new Set(value.map((profile) => profile.id));
    let index = value.length + 1;
    let id = `social-${index}`;
    while (used.has(id)) {
      index += 1;
      id = `social-${index}`;
    }
    onChange([...value, { id, platform: "instagram", url: "" }]);
  };

  const remove = (id: string) => {
    onChange(value.filter((profile) => profile.id !== id));
  };

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : null}

      {value.map((profile) => (
        <div
          key={profile.id}
          className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-[180px_1fr_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {labels.platform}
            </Label>
            <Select
              value={profile.platform}
              onValueChange={(next) =>
                update(profile.id, {
                  platform: next as SocialPlatform,
                  // A label only means anything for `other`; drop it otherwise so
                  // it cannot linger invisibly after switching platform.
                  label: next === "other" ? profile.label : undefined,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOCIAL_PLATFORMS.map((platform) => (
                  <SelectItem key={platform} value={platform}>
                    {SOCIAL_PLATFORM_LABELS[platform]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{labels.url}</Label>
            <Input
              type="url"
              inputMode="url"
              placeholder={SOCIAL_PLATFORM_PLACEHOLDERS[profile.platform]}
              value={profile.url}
              onChange={(e) => update(profile.id, { url: e.target.value })}
              disabled={disabled}
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => remove(profile.id)}
            disabled={disabled}
            aria-label={labels.remove}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>

          {profile.platform === "other" ? (
            <div className="space-y-1.5 sm:col-span-3">
              <Label className="text-xs text-muted-foreground">
                {labels.customLabel}
              </Label>
              <Input
                placeholder={labels.customLabelPlaceholder}
                value={profile.label ?? ""}
                onChange={(e) => update(profile.id, { label: e.target.value })}
                disabled={disabled}
              />
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={disabled || atLimit}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {labels.add}
        </Button>
        {atLimit ? (
          <p className="text-xs text-muted-foreground">{labels.limitReached}</p>
        ) : null}
      </div>
    </div>
  );
}
