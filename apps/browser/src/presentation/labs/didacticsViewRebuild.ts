/** Skips lesson-panel DOM rebuilds when the rendered content is unchanged. */
/**
 * Sampled frames re-render the lesson panel with identical content; rebuilding
 * nodes then drops text selection and re-announces live regions. Compare a key
 * of the inputs and leave the existing nodes alone when it is unchanged.
 */
export const rebuildIfChanged = (container: HTMLElement, key: unknown, build: () => void): void => {
  const serialized = JSON.stringify(key);
  if (container.dataset.renderKey === serialized) return;
  container.dataset.renderKey = serialized;
  container.replaceChildren();
  build();
};

/** Assigns text only when it differs, so an unchanged node keeps its selection and is not re-announced. */
export const setTextIfChanged = (element: HTMLElement, text: string): void => {
  if (element.textContent !== text) element.textContent = text;
};
