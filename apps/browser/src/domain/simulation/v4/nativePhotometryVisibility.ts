/** Computes native V4 geometric overlap and stellar visibility. */
import { clamp01, clamp11 } from "../../model/units";
import { integrateDiskMidpointShapes } from "../../photometry/diskMidpoint";
import { clampGridRes, type CircleOcculter } from "../../photometry/occulterCircle";
import type { OcculterShape } from "../../photometry/occulterTypes";
import {
  intensityNonNegative,
  type LimbDarkeningLaw,
  resolveAndValidateLimbDarkeningForStar,
} from "../../photometry/limbDarkening";
import { patchFactorAt, sanitizeBrightnessPatches } from "../../photometry/patches";
import { fluxLimbDarkenedDiskDetailed } from "../../photometry/transitLimbDarkened";
import { fluxStarWithTransmissiveOcculters } from "../../photometry/transitTransmission";
import type { VisibilityOcculter, VisibilityStar, VisibilityStarSurface } from "./nativePhotometryTypes";
import type { EducationScenarioV4, StarBodyV4 } from "./types";

export function circleOverlapArea(r1: number, r2: number, d: number): number {
  if (!(Number.isFinite(r1) && r1 > 0 && Number.isFinite(r2) && r2 > 0 && Number.isFinite(d) && d >= 0))
    return 0;
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
  }
  const x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const y = Math.sqrt(Math.max(0, r1 * r1 - x * x));
  const a1 = Math.acos(clamp11(x / r1));
  const a2 = Math.acos(clamp11((d - x) / r2));
  return r1 * r1 * a1 + r2 * r2 * a2 - d * y;
}

export function gaussianPhaseWeight(phase: number, sigma: number): number {
  const d = Math.atan2(Math.sin(phase), Math.cos(phase));
  const s = Math.max(1e-6, sigma);
  return Math.exp(-(d * d) / (2 * s * s));
}

export function starVisibilityFromOpaqueOcculters(
  config: EducationScenarioV4,
  star: VisibilityStar,
  occulters: Array<{ r: number; sky: { x: number; y: number; z: number } }>,
  surface?: VisibilityStarSurface,
): number {
  return starVisibilityFromOcculters(
    config,
    star,
    occulters.map((occulter) => ({ r: occulter.r, sky: occulter.sky, opacity: 1 })),
    surface,
  );
}

export function starVisibilityFromOcculters(
  config: EducationScenarioV4,
  star: VisibilityStar,
  occulters: VisibilityOcculter[],
  surface?: VisibilityStarSurface,
): number {
  if (!(star.r > 0) || occulters.length === 0) return 1;
  const opacities = occulters.map(occulterOpacity);
  const limbDarkeningLaw = resolveStarLimbDarkeningLaw(config, star);
  const brightnessPatches = surface?.brightnessPatches;
  if (occulters.some((occulter) => occulter.ring)) {
    return starVisibilityWithRingOcculters({
      star,
      occulters,
      opacities,
      limbDarkeningLaw,
      brightnessPatches,
      gridRes: config.photometry?.gridRes,
    });
  }
  const allOpaque = occulters.every(
    (occulter, index) => !occulter.transmissionAtRadius && opacities[index] >= 1 - 1e-12,
  );
  if (limbDarkeningLaw && allOpaque) {
    return fluxLimbDarkenedDiskDetailed({
      rStar: star.r,
      rOcculters: circleOccultersForStar(star, occulters),
      limbDarkeningLaw,
      brightnessPatches,
      gridRes: config.photometry?.gridRes,
    }).flux;
  }
  return fluxStarWithTransmissiveOcculters({
    rStar: star.r,
    occulters: transmissiveOccultersForStar(star, occulters, opacities),
    limbDarkening: limbDarkeningLaw,
    brightnessPatches,
    gridRes: config.photometry?.gridRes,
  });
}

/**
 * Mixed-shape path used when any occulter carries a ring. Opaque disks and ring annuli go
 * through the shape integrator, so a cell inside a planet disk is fully blocked and a ring
 * cell outside it is attenuated by (1 - opacity). Partially transparent or atmospheric disks
 * enter as a radial transmission factor on the intensity. The un-occulted reference uses the
 * same grid, limb darkening and patches, so the result is exactly 1 without overlap.
 */
const starVisibilityWithRingOcculters = (args: {
  star: VisibilityStar;
  occulters: VisibilityOcculter[];
  opacities: number[];
  limbDarkeningLaw: LimbDarkeningLaw | undefined;
  brightnessPatches: VisibilityStarSurface["brightnessPatches"];
  gridRes: number | undefined;
}): number => {
  const { star, occulters, opacities, limbDarkeningLaw } = args;
  const patches = sanitizeBrightnessPatches(args.brightnessPatches);
  const surfaceIntensity = (x: number, y: number, mu: number): number =>
    (limbDarkeningLaw ? intensityNonNegative(mu, limbDarkeningLaw) : 1) *
    patchFactorAt(x, y, patches, "multiply");
  const shapes: OcculterShape[] = [];
  const transmissive: ReturnType<typeof transmissiveOccultersForStar> = [];
  occulters.forEach((occulter, index) => {
    const dx = occulter.sky.x - star.sky.x;
    const dy = occulter.sky.y - star.sky.y;
    if (occulter.ring) shapes.push({ kind: "ring", dx, dy, ...occulter.ring });
    if (!occulter.transmissionAtRadius && opacities[index] >= 1 - 1e-12)
      shapes.push({ dx, dy, r: occulter.r });
    else transmissive.push(...transmissiveOccultersForStar(star, [occulter], [opacities[index]]));
  });
  const gridRes = clampGridRes(args.gridRes, 60);
  const reference = integrateDiskMidpointShapes({
    rStar: star.r,
    occulters: [],
    gridRes,
    intensityAt: ({ x, y, mu }) => surfaceIntensity(x, y, mu),
  }).total;
  const occulted = integrateDiskMidpointShapes({
    rStar: star.r,
    occulters: shapes,
    gridRes,
    intensityAt: ({ x, y, mu }) => surfaceIntensity(x, y, mu) * radialTransmissionAt(x, y, transmissive),
  });
  return reference > 1e-12 ? clamp01((occulted.total - occulted.blocked) / reference) : 1;
};

const transmissiveOccultersForStar = (
  star: VisibilityStar,
  occulters: VisibilityOcculter[],
  opacities: number[],
): Array<{ dx: number; dy: number; r0: number; transmission: (rho: number) => number }> =>
  occulters.map((occulter, index) => ({
    dx: occulter.sky.x - star.sky.x,
    dy: occulter.sky.y - star.sky.y,
    r0: occulter.r,
    transmission: occulter.transmissionAtRadius ?? ((rho) => (rho <= occulter.r ? 1 - opacities[index] : 1)),
  }));

const radialTransmissionAt = (
  x: number,
  y: number,
  occulters: ReturnType<typeof transmissiveOccultersForStar>,
): number =>
  occulters.reduce((product, occulter) => {
    const transmission = occulter.transmission(Math.hypot(x - occulter.dx, y - occulter.dy));
    return product * (Number.isFinite(transmission) ? clamp01(transmission) : 1);
  }, 1);

const circleOccultersForStar = (star: VisibilityStar, occulters: VisibilityOcculter[]): CircleOcculter[] =>
  occulters.map((occulter) => ({
    dx: occulter.sky.x - star.sky.x,
    dy: occulter.sky.y - star.sky.y,
    r: occulter.r,
  }));
const occulterOpacity = (occulter: VisibilityOcculter): number =>
  clamp01(Number.isFinite(occulter.opacity) ? (occulter.opacity as number) : 1);

const resolveStarLimbDarkeningLaw = (config: EducationScenarioV4, star: VisibilityStar) => {
  const model = config.photometry?.limbDarkeningModel;
  if (!model) return undefined;
  const stellarSource = star.kind === "star" ? (star.source as StarBodyV4) : undefined;
  return resolveAndValidateLimbDarkeningForStar({
    model,
    star: stellarSource
      ? {
          teffK: stellarSource.teffK,
          loggCgs: stellarSource.loggCgs,
          metallicityDex: stellarSource.metallicityDex,
          bandpass: stellarSource.passband,
        }
      : undefined,
  });
};
