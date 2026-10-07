/** Resolves the projected oblate silhouette of a planet or moon for photometry and rendering. */
import type { BrowserRenderSignals } from "../frames";
import type { NativeBodyState } from "./nativeSnapshot";
import type { EducationScenarioV4 } from "./types";

export type OblateSilhouette = { rx: number; ry: number; angle: number };

/**
 * Seager & Hui (2002) silhouette with the spin axis in the sky plane: semi-axes Re and
 * Re (1 - f), major axis rotated by `shape.angle`. Only active with `nonSphericalFlux`;
 * stars, bodies without a valid oblateness, and bodies that carry an enabled atmospheric
 * transmission model (their flux uses the circular transmissive path) stay circular.
 */
/** True when an enabled atmosphere model targets this body kind (its occulter is transmissive). */
const hasAtmosphericTransmission = (config: EducationScenarioV4, kind: "planet" | "moon"): boolean => {
  const photometry = config.photometry;
  const legacy = photometry?.atmosphereTransmission;
  const rt = photometry?.atmosphereRT;
  return (
    (legacy?.enabled === true && (legacy.target ?? "planet") === kind) ||
    (rt?.enabled === true && (rt.target ?? "planet") === kind)
  );
};

const finiteOblateness = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : undefined;

const finitePositive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const finiteAngleOrZero = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const oblateSilhouetteForBody = (
  config: EducationScenarioV4,
  body: NativeBodyState,
): OblateSilhouette | undefined => {
  if (config.dynamics?.physicsFeatures?.nonSphericalFlux !== true) return undefined;
  if (body.kind !== "planet" && body.kind !== "moon") return undefined;
  if (hasAtmosphericTransmission(config, body.kind)) return undefined;
  const f = finiteOblateness(body.source.shape?.oblateness);
  const re = finitePositive(body.source.r);
  if (f === undefined || re === undefined) return undefined;
  return { rx: re, ry: re * (1 - f), angle: finiteAngleOrZero(body.source.shape?.angle) };
};

/** Appends the render occulter of a body: an ellipse for an oblate silhouette, else its circle. */
export const appendBodyOcculter = (
  out: BrowserRenderSignals["occulterGeometry"],
  config: EducationScenarioV4,
  body: NativeBodyState | undefined,
  center: { x: number; y: number; z: number } | undefined,
  label: "star" | "planet" | "moon",
): void => {
  if (!body || !(body.r > 0) || !center) return;
  const silhouette = oblateSilhouetteForBody(config, body);
  if (silhouette) out.push({ body: label, kind: "ellipse", center, ...silhouette });
  else out.push({ body: label, kind: "circle", center, radius: body.r });
};
