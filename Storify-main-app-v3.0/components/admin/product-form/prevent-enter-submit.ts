import type { KeyboardEvent } from "react";

/** Inputs where Enter is a deliberate press of the control itself. */
const BUTTON_LIKE_INPUTS = new Set(["submit", "button", "reset", "image", "file"]);

/**
 * Stops Enter in a text field from saving the product.
 *
 * Browsers submit a form when Enter is pressed in one of its single-line
 * fields. A barcode scanner types the code and then presses Enter, so a scan
 * into the Barcode or SKU field saved a product that was only half filled in.
 * Enter in the title did the same. Only the Save button saves.
 *
 * Only fields that belong to this form are affected. A field's own Enter
 * handling (adding a tag, committing a number) still runs, because this
 * handler sits on the form and runs after the field's. Dialogs opened from the
 * form are portalled out of it, so their fields belong to another form or none
 * and are left alone. Enter that confirms an input-method composition is not
 * a submit either, so it is left alone too.
 */
export function preventEnterSubmit(event: KeyboardEvent<HTMLFormElement>) {
  const target = event.target;
  if (
    event.key === "Enter" &&
    !event.nativeEvent.isComposing &&
    target instanceof HTMLInputElement &&
    target.form === event.currentTarget &&
    !BUTTON_LIKE_INPUTS.has(target.type)
  ) {
    event.preventDefault();
  }
}
