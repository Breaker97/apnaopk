/**
 * A plain till slip — a drawer report, a return slip — printed from a small
 * window at receipt width. Returns false when the browser blocked the window.
 *
 * Sales print through the till's own receipt printer path (pos-terminal);
 * these are the counter's other paper, which needs no QR code or logo.
 */
export function printSlip(params: {
  title: string;
  /** Lines under the title: the store, the counter, a reference number. */
  heading?: Array<string | null | undefined>;
  rows: Array<[string, string]>;
  footer?: string | null;
}): boolean {
  const handle = window.open("", "_blank", "width=420,height=640");
  if (!handle) return false;
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
    );
  const heading = (params.heading || []).filter((line): line is string => Boolean(line));
  handle.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(params.title)}</title>
<style>body{font-family:ui-monospace,Menlo,monospace;font-size:12px;width:72mm;margin:0 auto;padding:8px;color:#000;background:#fff}
h1{font-size:14px;text-align:center;margin:0 0 2px}p{text-align:center;margin:2px 0}.r{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
.dash{border-top:1px dashed #000;margin:6px 0}</style></head><body>
<h1>${escape(params.title)}</h1>
${heading.map((line) => `<p>${escape(line)}</p>`).join("")}<div class="dash"></div>
${params.rows.map(([label, value]) => `<div class="r"><span>${escape(label)}</span><span>${escape(value)}</span></div>`).join("")}
${params.footer ? `<div class="dash"></div><p>${escape(params.footer)}</p>` : ""}
</body></html>`);
  handle.document.close();
  handle.focus();
  handle.print();
  return true;
}
