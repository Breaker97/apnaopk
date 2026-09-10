/**
 * Download an AI-generated/stored image directly (no new tab). Routes the URL
 * through the same-origin download proxy, which streams it back with a
 * Content-Disposition attachment header so the browser saves it straight away.
 */
export function downloadAiImage(url: string, filename: string) {
  const href = `/api/ai-authoring/download?url=${encodeURIComponent(
    url,
  )}&name=${encodeURIComponent(filename)}`;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
