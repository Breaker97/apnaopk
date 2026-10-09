"use client";

import {
  useEditor,
  EditorContent,
  Node as TiptapNode,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Quote,
  Code,
  Code2,
  Minus,
  Undo,
  Redo,
  Unlink,
  ImagePlus,
  ImageUp,
  Loader2,
  X,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { toast } from "./toast-notification";

type RichTextImageOptions = {
  HTMLAttributes: Record<string, unknown>;
};

function RichTextImageView({
  node,
  selected,
  deleteNode,
}: ReactNodeViewProps) {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";

  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    deleteNode();
  };

  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={cn(
        "group relative my-4 inline-block max-w-full overflow-hidden align-top sm:max-w-[720px]",
        selected && "rounded-md outline outline-2 outline-primary",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        title={title || undefined}
        draggable={false}
        className="h-auto max-h-[360px] w-auto max-w-full rounded-md border border-border object-contain"
      />
      <div
        data-drag-handle
        draggable
        contentEditable={false}
        title="Drag image"
        className={cn(
          "absolute left-2 top-2 h-8 w-8 cursor-grab items-center justify-center rounded-md border bg-background/95 text-muted-foreground shadow-sm active:cursor-grabbing",
          selected ? "flex" : "hidden group-hover:flex",
        )}
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <button
        type="button"
        contentEditable={false}
        aria-label="Remove image"
        title="Remove image"
        onMouseDown={keepEditorSelection}
        onClick={handleRemove}
        className={cn(
          "absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-md border bg-background/95 text-muted-foreground shadow-sm transition hover:bg-destructive hover:text-destructive-foreground",
          selected ? "flex" : "hidden group-hover:flex",
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </NodeViewWrapper>
  );
}

const RichTextImage = TiptapNode.create<RichTextImageOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class:
          "my-4 h-auto max-h-[420px] w-auto max-w-full rounded-md border border-border object-contain",
      },
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RichTextImageView);
  },
});

function isAllowedImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return true;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseCssFontSize(style: string) {
  const match = style.match(/font-size\s*:\s*([\d.]+)\s*(px|pt|rem|em)?/i);
  if (!match) return 0;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;

  const unit = match[2]?.toLowerCase();
  if (unit === "pt") return value * 1.333;
  if (unit === "rem" || unit === "em") return value * 16;
  return value;
}

function parseCssFontWeight(style: string) {
  const match = style.match(/font-weight\s*:\s*([^;]+)/i);
  if (!match) return 0;

  const value = match[1].trim().toLowerCase();
  if (value === "bold" || value === "bolder") return 700;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getLargestStyledFontSize(element: Element) {
  const sizes = [parseCssFontSize(element.getAttribute("style") || "")];
  element.querySelectorAll("[style]").forEach((child) => {
    sizes.push(parseCssFontSize(child.getAttribute("style") || ""));
  });

  return Math.max(...sizes);
}

function hasBoldStyling(element: Element) {
  if (element.querySelector("strong, b")) return true;

  const weights = [parseCssFontWeight(element.getAttribute("style") || "")];
  element.querySelectorAll("[style]").forEach((child) => {
    weights.push(parseCssFontWeight(child.getAttribute("style") || ""));
  });

  return Math.max(...weights) >= 600;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInlineText(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function getCleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isNumberedLine(value: string) {
  return /^\d+[\.)]\s+\S/.test(value.trim());
}

function isBulletLine(value: string) {
  return /^[-*•]\s+\S/.test(value.trim());
}

function isShortHeadingText(value: string) {
  const text = getCleanText(value);
  return (
    text.length > 0 &&
    text.length <= 120 &&
    !/[.!?;:]$/.test(text) &&
    !/^last updated\b/i.test(text)
  );
}

function isNumberedSectionText(value: string) {
  return isNumberedLine(value) && isShortHeadingText(value.replace(/^\d+[\.)]\s+/, ""));
}

function shouldTreatAsOrderedList(lines: string[], index: number) {
  return isNumberedLine(lines[index] || "") && isNumberedLine(lines[index + 1] || "");
}

function shouldTreatAsLooseList(lines: string[], index: number) {
  if (!lines[index]?.trim().endsWith(":")) return false;

  let count = 0;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]?.trim() || "";
    if (!line || isNumberedSectionText(line) || isBulletLine(line)) break;
    count += 1;
    if (count >= 2) return true;
  }

  return false;
}

function collectParagraphLines(lines: string[], startIndex: number) {
  const paragraph: string[] = [];
  let cursor = startIndex;

  while (cursor < lines.length) {
    const line = lines[cursor]?.trim() || "";
    if (!line) break;
    if (cursor !== startIndex) {
      if (
        isBulletLine(line) ||
        isNumberedSectionText(line) ||
        shouldTreatAsOrderedList(lines, cursor) ||
        shouldTreatAsLooseList(lines, cursor)
      ) {
        break;
      }
    }
    paragraph.push(line);
    cursor += 1;
  }

  return { paragraph, nextIndex: cursor };
}

function transformPastedPlainText(text: string) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const meaningfulLines = lines.filter(Boolean);
  if (meaningfulLines.length < 2) return null;

  const html: string[] = [];
  let index = 0;
  let hasSeenContent = false;

  while (index < lines.length) {
    const line = lines[index]?.trim() || "";
    if (!line) {
      index += 1;
      continue;
    }

    const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
    if (markdownHeading) {
      const level = markdownHeading[1].length;
      html.push(`<h${level}>${formatInlineText(markdownHeading[2])}</h${level}>`);
      hasSeenContent = true;
      index += 1;
      continue;
    }

    if (!hasSeenContent && isShortHeadingText(line)) {
      html.push(`<h1>${formatInlineText(line)}</h1>`);
      hasSeenContent = true;
      index += 1;
      continue;
    }

    if (shouldTreatAsOrderedList(lines, index)) {
      const items: string[] = [];
      while (isNumberedLine(lines[index] || "")) {
        items.push(
          `<li>${formatInlineText((lines[index] || "").replace(/^\d+[\.)]\s+/, ""))}</li>`,
        );
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      hasSeenContent = true;
      continue;
    }

    if (isNumberedSectionText(line)) {
      html.push(`<h2>${formatInlineText(line)}</h2>`);
      hasSeenContent = true;
      index += 1;
      continue;
    }

    if (isBulletLine(line)) {
      const items: string[] = [];
      while (isBulletLine(lines[index] || "")) {
        items.push(
          `<li>${formatInlineText((lines[index] || "").replace(/^[-*•]\s+/, ""))}</li>`,
        );
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      hasSeenContent = true;
      continue;
    }

    if (shouldTreatAsLooseList(lines, index)) {
      html.push(`<p>${formatInlineText(line)}</p>`);
      index += 1;
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]?.trim() || "";
        if (!item || isNumberedSectionText(item) || isBulletLine(item)) break;
        items.push(`<li>${formatInlineText(item)}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      hasSeenContent = true;
      continue;
    }

    const { paragraph, nextIndex } = collectParagraphLines(lines, index);
    html.push(`<p>${formatInlineText(paragraph.join(" "))}</p>`);
    hasSeenContent = true;
    index = nextIndex;
  }

  return html.join("");
}

function transformPastedRichText(html: string) {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.body.querySelector("h1, h2, h3, h4, h5, h6")) {
    return html;
  }

  let hasSeenContent = false;

  doc.body.querySelectorAll("p, div").forEach((block) => {
    if (
      block.querySelector(
        "address, article, aside, blockquote, div, dl, fieldset, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, main, nav, ol, p, pre, section, table, ul",
      )
    ) {
      return;
    }

    const text = block.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text) return;

    const fontSize = getLargestStyledFontSize(block);
    const tagName =
      !hasSeenContent && isShortHeadingText(text)
        ? "h1"
        : isNumberedSectionText(text)
          ? "h2"
          : hasBoldStyling(block) && fontSize >= 26
            ? "h1"
            : hasBoldStyling(block) && fontSize >= 20
              ? "h2"
              : hasBoldStyling(block) && fontSize >= 17
                ? "h3"
                : null;
    hasSeenContent = true;
    if (!tagName) return;

    const heading = doc.createElement(tagName);
    // Move the existing child nodes instead of round-tripping through innerHTML
    // so no HTML string is re-parsed (avoids any markup-injection surface).
    while (block.firstChild) {
      heading.appendChild(block.firstChild);
    }
    const textAlign = block
      .getAttribute("style")
      ?.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1];
    if (textAlign) {
      heading.setAttribute("style", `text-align: ${textAlign.toLowerCase()}`);
    }
    block.replaceWith(heading);
  });

  Array.from(doc.body.children).forEach((child) => {
    const text = getCleanText(child.textContent || "");
    if (!text.endsWith(":")) return;

    const listItems: Element[] = [];
    let sibling = child.nextElementSibling;

    while (sibling) {
      const siblingText = getCleanText(sibling.textContent || "");
      if (
        !siblingText ||
        isNumberedSectionText(siblingText) ||
        isBulletLine(siblingText) ||
        !["P", "DIV"].includes(sibling.tagName) ||
        sibling.querySelector("address, article, aside, blockquote, div, dl, fieldset, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, main, nav, ol, p, pre, section, table, ul")
      ) {
        break;
      }

      listItems.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    if (listItems.length < 2) return;

    const list = doc.createElement("ul");
    listItems.forEach((item) => {
      const li = doc.createElement("li");
      // Move existing child nodes instead of round-tripping through innerHTML
      // so no HTML string is re-parsed (avoids any markup-injection surface).
      while (item.firstChild) {
        li.appendChild(item.firstChild);
      }
      list.appendChild(li);
      item.remove();
    });
    child.after(list);
  });

  return doc.body.innerHTML;
}

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Optional extra image source rendered in the toolbar next to the upload/URL
   * button — e.g. an AI Studio trigger. Receives `insertImage`, which drops a
   * hosted image (plus a trailing paragraph) at the cursor, exactly like the
   * built-in upload path. Kept generic so this editor stays decoupled from the
   * AI-authoring stack; the caller owns the trigger and its overlay.
   */
  imageStudioSlot?: (
    insertImage: (src: string, alt?: string) => void,
  ) => ReactNode;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: ReactNode;
  title: string;
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  children,
  title,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      className={cn("h-8 w-8 p-0", isActive && "bg-muted text-foreground")}
      title={title}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something...",
  disabled = false,
  className,
  imageStudioSlot,
}: RichTextEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        link: false,
        underline: false,
      }),
      RichTextImage,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline",
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      transformPastedHTML: transformPastedRichText,
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData;
        const html = clipboard?.getData("text/html") || "";
        const text = clipboard?.getData("text/plain") || "";

        if (html.trim()) return false;

        const transformed = transformPastedPlainText(text);
        if (!transformed) return false;

        const container = document.createElement("div");
        // transformed is built from escaped plain text, but sanitize before
        // assigning to innerHTML so this path can never inject active markup.
        container.innerHTML = sanitizeHtml(transformed);
        const slice = ProseMirrorDOMParser.fromSchema(
          view.state.schema,
        ).parseSlice(container);

        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;

    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    if (url === null) return;

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const insertImage = useCallback(
    (src: string, alt = "") => {
      if (!editor) return;

      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "image",
            attrs: { src, alt },
          },
          {
            type: "paragraph",
          },
        ])
        .run();
    },
    [editor],
  );

  const setImageFromUrl = useCallback(() => {
    const url = window.prompt("Image URL");
    if (url === null) return;

    const trimmed = url.trim();
    if (!isAllowedImageUrl(trimmed)) {
      toast.error("Enter a valid image URL");
      return;
    }

    insertImage(trimmed);
  }, [insertImage]);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose an image file");
        return;
      }

      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error("Image is too large", {
          description: "Maximum image size is 20MB.",
        });
        return;
      }

      setIsUploadingImage(true);

      try {
        const formData = new FormData();
        formData.append("files", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const result = await res.json();
        const uploaded = Array.isArray(result?.data) ? result.data[0] : null;

        if (!res.ok || !result?.success || !uploaded?.url) {
          throw new Error(
            Array.isArray(result?.errors) && result.errors.length > 0
              ? result.errors.join(", ")
              : result?.message || "Upload failed",
          );
        }

        const alt = file.name.replace(/\.[^/.]+$/, "");
        insertImage(uploaded.url, alt);
        toast.success("Image added to description");
      } catch (error) {
        toast.error("Failed to upload image", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setIsUploadingImage(false);
      }
    },
    [insertImage],
  );

  const handleImageSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        void uploadImage(file);
      }
    },
    [uploadImage],
  );

  if (!editor) {
    return (
      <div
        className={cn(
          "border rounded-lg p-4 min-h-[200px] bg-muted/50 animate-pulse",
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden",
        disabled && "opacity-50",
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b p-1 bg-muted/30">
        {/* Undo/Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
          title="Undo"
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
          title="Redo"
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Headings */}
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          isActive={editor.isActive("heading", { level: 1 })}
          disabled={disabled}
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          isActive={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          isActive={editor.isActive("heading", { level: 3 })}
          disabled={disabled}
          title="Heading 3"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setParagraph().run()}
          isActive={editor.isActive("paragraph")}
          disabled={disabled}
          title="Paragraph"
        >
          <Pilcrow className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Text Formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          disabled={disabled}
          title="Bold"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          disabled={disabled}
          title="Italic"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive("underline")}
          disabled={disabled}
          title="Underline"
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          disabled={disabled}
          title="Strikethrough"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          disabled={disabled}
          title="Inline Code"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          disabled={disabled}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          disabled={disabled}
          title="Ordered List"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          disabled={disabled}
          title="Blockquote"
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
          disabled={disabled}
          title="Code Block"
        >
          <Code2 className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          isActive={editor.isActive({ textAlign: "left" })}
          disabled={disabled}
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          isActive={editor.isActive({ textAlign: "center" })}
          disabled={disabled}
          title="Align Center"
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          isActive={editor.isActive({ textAlign: "right" })}
          disabled={disabled}
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={disabled}
          title="Horizontal Rule"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Image */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || isUploadingImage}
              className="h-8 w-8 p-0"
              title="Insert Image"
            >
              {isUploadingImage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => imageInputRef.current?.click()}
              disabled={disabled || isUploadingImage}
            >
              <ImageUp className="h-4 w-4" />
              Upload image
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={setImageFromUrl}
              disabled={disabled || isUploadingImage}
            >
              <LinkIcon className="h-4 w-4" />
              Image URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Extra image source (e.g. AI Studio), grouped with the image controls */}
        {imageStudioSlot?.(insertImage)}

        <div className="w-px h-6 bg-border mx-1" />

        {/* Link */}
        <ToolbarButton
          onClick={setLink}
          isActive={editor.isActive("link")}
          disabled={disabled}
          title="Add Link"
        >
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        {editor.isActive("link") && (
          <ToolbarButton
            onClick={() => editor.chain().focus().unsetLink().run()}
            disabled={disabled}
            title="Remove Link"
          >
            <Unlink className="h-4 w-4" />
          </ToolbarButton>
        )}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        disabled={disabled || isUploadingImage}
        className="hidden"
      />

      {/* Editor Content */}
      <EditorContent
        editor={editor}
        className="rich-text-content max-h-[520px] min-h-[150px] max-w-none overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden hover:scrollbar-thin hover:[scrollbar-color:var(--border)_transparent] hover:[&::-webkit-scrollbar]:block hover:[&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-border/50 p-4 focus-within:outline-none [&_.ProseMirror]:min-h-[120px] [&_.ProseMirror]:outline-none [&_.ProseMirror_figure]:max-w-full [&_.ProseMirror_figure]:sm:max-w-[720px] [&_.ProseMirror_img]:h-auto [&_.ProseMirror_img]:max-h-[360px] [&_.ProseMirror_img]:w-auto [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-md [&_.ProseMirror_img]:border [&_.ProseMirror_img]:border-border [&_.ProseMirror_img]:object-contain [&_.ProseMirror_img.ProseMirror-selectednode]:outline [&_.ProseMirror_img.ProseMirror-selectednode]:outline-2 [&_.ProseMirror_img.ProseMirror-selectednode]:outline-primary [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
