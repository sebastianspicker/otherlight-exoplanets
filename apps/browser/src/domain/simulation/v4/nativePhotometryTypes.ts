/** Defines shared native V4 photometry types. */
import type { BrightnessPatch } from "../../model/types";
import type { StarBodyV4 } from "./types";

export type WeightedPhotometryBand = { lambdaNm: number; weight: number; legacyTauScale: number };
export type PhotometricBody = {
  kind: "star" | "planet" | "moon";
  r: number;
  sky: { x: number; y: number; z: number };
};
export type VisibilityStar = PhotometricBody & { source: StarBodyV4 | unknown };
/** Planetary ring annulus centred on its occulter; radii in the sky-plane length unit. */
export type VisibilityRing = {
  rInner: number;
  rOuter: number;
  /** Tilt away from face-on [rad]. */
  inc?: number;
  /** Sky-plane position angle of the projected major axis [rad]. */
  angle?: number;
  /** Ring opacity in [0, 1]. */
  opacity: number;
};
export type VisibilityOcculter = {
  r: number;
  sky: { x: number; y: number; z: number };
  opacity?: number;
  transmissionAtRadius?: (rho: number) => number;
  ring?: VisibilityRing;
};
/** Stellar surface map applied to the occulted star's intensity. */
export type VisibilityStarSurface = { brightnessPatches?: BrightnessPatch[] };
