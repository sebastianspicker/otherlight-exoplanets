/**
 * Deep Field ink for canvas evidence.
 *
 * Two surfaces exist, both dark. The sky "plate" is the deepest ground because
 * it depicts light against the sky. The "figure" (light curve, O-C history)
 * sits on the panel surface with starlight ink. Callers keep passing their
 * semantic hex colors; `inkFor` translates the A/B trace roles for the surface
 * and leaves every other authored color as it is, since those pastel tones
 * were chosen to read on a dark ground.
 *
 * Values mirror the color roles in `styles/deep-field/tokens.css`.
 */

export type InkSurface = "figure" | "plate";

export type FigureInk = {
  paper: string;
  ink: string;
  ink2: string;
  ink3: string;
  frame: string;
  tick: string;
  grid: string;
  traceA: string;
  traceB: string;
  caution: string;
  fault: string;
  chip: string;
  chipRule: string;
};

/** The figure ground is the panel surface (`--surface`) so the canvas sits flush in its panel. */
const FIGURE: FigureInk = {
  paper: "#0d1017",
  ink: "#e9ecf2",
  ink2: "#b4bccb",
  ink3: "#8e97aa",
  frame: "rgba(160, 176, 214, 0.34)",
  tick: "rgba(200, 210, 232, 0.6)",
  grid: "rgba(160, 176, 214, 0.07)",
  traceA: "#e9ecf2",
  traceB: "#8ab4ff",
  caution: "#e8c26e",
  fault: "#ff8f86",
  chip: "rgba(13, 16, 23, 0.92)",
  chipRule: "rgba(160, 176, 214, 0.3)",
};

/** The sky plate (`--plate`): the deepest surface. */
export const PLATE_INK = {
  sky: "#03050a",
  skyGlow: "#0a1020",
  ink: "#dfe4ee",
  ink3: "#7f899e",
  traceA: "#dfe4ee",
  traceB: "#8ab4ff",
} as const;

export const FIGURE_FONTS = {
  mono: '"Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: '"Atkinson Hyperlegible Next", system-ui, sans-serif',
  serif: '"STIX Two Text", "STIX Two", Georgia, serif',
} as const;

/** Figure ink, read at draw time. */
export function figureInk(): FigureInk {
  return FIGURE;
}

/* Semantic trace colors used by callers: A is the accepted model, B the changed one. */
const TRACE_A = ["#9ddcff", "#4cc9f0"];
const TRACE_B = ["#f3cf87"];

function table(entries: [string[], string][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const [keys, value] of entries) for (const key of keys) map.set(key, value);
  return map;
}

const FIGURE_TABLE = table([
  [TRACE_A, FIGURE.traceA],
  [TRACE_B, FIGURE.traceB],
]);

const PLATE_TABLE = table([
  [TRACE_A, PLATE_INK.traceA],
  [TRACE_B, PLATE_INK.traceB],
]);

const normalize = (color: string): string => color.toLowerCase().replace(/\s+/g, "");

/** Translate a caller's semantic color for the surface it is drawn on. */
export function inkFor(color: string, surface: InkSurface): string {
  const lookup = surface === "plate" ? PLATE_TABLE : FIGURE_TABLE;
  return lookup.get(normalize(color)) ?? color;
}
