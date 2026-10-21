import { resolveBinding } from "@/lib/invoice-templates/bindings";
import { bindingOptions } from "../render-context";
import type { ElementRenderProps } from "../types";

/** Fixed text, or a data field with text around it (§4.7.2). */
export function TextElement({ element, context, design }: ElementRenderProps<"text">) {
  const text = resolveBinding(element.binding, context, bindingOptions(element, design));
  if (text === null) return null;
  return (
    <div className="it-text" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text}
    </div>
  );
}
