"use client";

/**
 * Arrange (§5.4), above the canvas: align to the page (its printable area)
 * or to the selection, distribute three or more, layer order, duplicate,
 * delete, lock and hide. Each button is one undo step. Locked elements stay
 * put and aren't deleted; the buttons that could only act on them are off.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  SendToBack,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DISTRIBUTE_MIN, type AlignEdge, type AlignTarget } from "@/lib/invoice-templates/editor/arrange";
import { cn } from "@/lib/utils";
import { selectedElements, useEditor, useEditorApi } from "./editor-store";

const ALIGN: { edge: AlignEdge; icon: LucideIcon }[] = [
  { edge: "left", icon: AlignStartVertical },
  { edge: "centre", icon: AlignCenterVertical },
  { edge: "right", icon: AlignEndVertical },
  { edge: "top", icon: AlignStartHorizontal },
  { edge: "middle", icon: AlignCenterHorizontal },
  { edge: "bottom", icon: AlignEndHorizontal },
];

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  pressed,
  action,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  action: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={label}
          aria-pressed={pressed}
          data-arrange={action}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center">
      {children}
    </div>
  );
}

export function ArrangeBar({ className }: { className?: string }) {
  const t = useTranslations("admin.invoiceTemplates.editor.arrange");
  const api = useEditorApi();
  const selected = useEditor(useShallow((state) => selectedElements(state)));
  const [preferred, setPreferred] = useState<AlignTarget>("selection");

  const count = selected.length;
  const unlocked = selected.filter((element) => !element.locked);
  // One element can only line up with the page.
  const target: AlignTarget = count > 1 ? preferred : "page";
  const allHidden = count > 0 && selected.every((element) => element.hidden);
  const allLocked = count > 0 && selected.every((element) => element.locked);
  const ids = selected.map((element) => element.id);
  const store = () => api.getState();

  return (
    <div
      role="toolbar"
      aria-label={t("label")}
      // One fixed-height row that scrolls sideways when narrow: if it wrapped, selecting
      // something would shorten the canvas and change a fitted zoom under the pointer.
      className={cn("flex h-11 shrink-0 flex-nowrap items-center overflow-x-auto overflow-y-hidden border-b border-border bg-card px-2", className)}
      data-editor-arrange=""
    >
      {count === 0 ? (
        <p className="truncate px-2 text-xs text-muted-foreground">{t("nothingSelected")}</p>
      ) : (
        <>
          <Group label={t("align")}>
            {ALIGN.map(({ edge, icon }) => (
              <ToolButton
                key={edge}
                action={`align-${edge}`}
                label={t(edge)}
                icon={icon}
                disabled={unlocked.length === 0}
                onClick={() => store().alignSelection(edge, target)}
              />
            ))}
            <div className="ms-1 inline-flex rounded-[8px] border border-border p-0.5 text-xs" role="radiogroup" aria-label={t("alignTo")}>
              {(["page", "selection"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={target === value}
                  disabled={value === "selection" && count < 2}
                  onClick={() => setPreferred(value)}
                  className={cn(
                    "rounded-[6px] px-2 py-0.5 font-medium transition-colors disabled:opacity-40",
                    target === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "page" ? t("toPage") : t("toSelection")}
                </button>
              ))}
            </div>
          </Group>
          <Divider />
          <Group label={t("distribute")}>
            <ToolButton
              action="distribute-horizontal"
              label={t("distributeH")}
              icon={AlignHorizontalDistributeCenter}
              disabled={unlocked.length < DISTRIBUTE_MIN}
              onClick={() => store().distributeSelection("horizontal")}
            />
            <ToolButton
              action="distribute-vertical"
              label={t("distributeV")}
              icon={AlignVerticalDistributeCenter}
              disabled={unlocked.length < DISTRIBUTE_MIN}
              onClick={() => store().distributeSelection("vertical")}
            />
          </Group>
          <Divider />
          <Group label={t("order")}>
            <ToolButton action="front" label={t("front")} icon={BringToFront} onClick={() => store().reorderSelection("front")} />
            <ToolButton action="forward" label={t("forward")} icon={ChevronsUp} onClick={() => store().reorderSelection("forward")} />
            <ToolButton action="backward" label={t("backward")} icon={ChevronsDown} onClick={() => store().reorderSelection("backward")} />
            <ToolButton action="back" label={t("back")} icon={SendToBack} onClick={() => store().reorderSelection("back")} />
          </Group>
          <Divider />
          <Group label={t("element")}>
            <ToolButton action="duplicate" label={t("duplicate")} icon={Copy} onClick={() => store().duplicateSelection()} />
            <ToolButton
              action="lock"
              label={allLocked ? t("unlock") : t("lock")}
              icon={allLocked ? LockOpen : Lock}
              pressed={allLocked}
              onClick={() => store().setFlag(ids, "locked", !allLocked)}
            />
            <ToolButton
              action="hide"
              label={allHidden ? t("show") : t("hide")}
              icon={allHidden ? Eye : EyeOff}
              pressed={allHidden}
              onClick={() => store().setFlag(ids, "hidden", !allHidden)}
            />
            <ToolButton
              action="delete"
              label={t("delete")}
              icon={Trash2}
              disabled={unlocked.length === 0}
              onClick={() => store().deleteSelection()}
            />
          </Group>
          {count > 1 && (
            <span className="ms-auto shrink-0 px-2 text-xs text-muted-foreground" aria-hidden>
              {t("selectedCount", { count })}
            </span>
          )}
        </>
      )}
    </div>
  );
}
