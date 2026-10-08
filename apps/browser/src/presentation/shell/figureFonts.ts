/**
 * Repaints canvas figures once the self-hosted faces are available.
 */

/** Canvas text uses the self-hosted faces; redraw figures when the web fonts finish loading. */
export function wireFigureFonts(redraw: () => void, signal: AbortSignal): void {
  if (typeof document === "undefined") return;
  redraw();
  document.fonts?.ready.then(() => {
    if (!signal.aborted) redraw();
  });
}
