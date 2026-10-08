/** Fuses circular occultation integration across a shared spectral grid. */
import { clamp01, isFiniteNumber, isFinitePositive } from "../../model/units";
import { clampGridRes, MAX_TRANSIT_GRID_RES } from "../../photometry/occulterCircle";
import { intensityNonNegative, type LimbDarkeningLaw } from "../../photometry/limbDarkening";
import { patchFactorAt, sanitizeBrightnessPatches } from "../../photometry/patches";
import type { VisibilityOcculter, VisibilityStar, VisibilityStarSurface } from "./nativePhotometryTypes";

type SpectralIntegrationContext = {
  occulters: VisibilityOcculter[];
  bands: Array<{ weight: number }>;
  offsetsX: number[];
  offsetsY: number[];
  radii: Float64Array;
  opacities: number[];
  transmissions: Array<Array<((rho: number) => number) | undefined>>;
  transmittedSums: Float64Array;
};

/** Integrates all wavelengths in one disk traversal while composing each wavelength independently. */
export function integrateCircularSpectralVisibility(args: {
  star: VisibilityStar;
  occulters: VisibilityOcculter[];
  bands: Array<{ weight: number }>;
  limbDarkeningLaw: LimbDarkeningLaw | undefined;
  surface?: VisibilityStarSurface;
  gridRes?: number;
}): number {
  const { star, occulters, bands, limbDarkeningLaw, surface } = args;
  if (!(star.r > 0) || bands.length === 0) return 1;
  if (!isFinitePositive(star.r)) {
    throw new Error("fluxStarWithTransmissiveOcculters: rStar must be > 0 and finite.");
  }

  const gridSize = clampGridRes(isFiniteNumber(args.gridRes) ? Math.floor(args.gridRes) : args.gridRes, 256, {
    minRes: 32,
    maxRes: MAX_TRANSIT_GRID_RES,
  });
  const step = (2 * star.r) / gridSize;
  const halfStep = 0.5 * step;
  const starRadiusSquared = star.r * star.r;
  const offsetsX = occulters.map((occulter) => occulter.sky.x - star.sky.x);
  const offsetsY = occulters.map((occulter) => occulter.sky.y - star.sky.y);
  const radii = new Float64Array(occulters.length);
  const opacities = occulters.map((occulter) =>
    clamp01(Number.isFinite(occulter.opacity) ? (occulter.opacity as number) : 1),
  );
  const transmissions = bands.map((_, bandIndex) =>
    occulters.map(
      (occulter) =>
        occulter.transmissionByBand?.[bandIndex]?.transmissionAtRadius ?? occulter.transmissionAtRadius,
    ),
  );
  const patches = sanitizeBrightnessPatches(surface?.brightnessPatches);
  const transmittedSums = new Float64Array(bands.length);
  const context: SpectralIntegrationContext = {
    occulters,
    bands,
    offsetsX,
    offsetsY,
    radii,
    opacities,
    transmissions,
    transmittedSums,
  };
  const intensitySum = integrateDiskGrid({
    starRadius: star.r,
    starRadiusSquared,
    gridSize,
    step,
    halfStep,
    limbDarkeningLaw,
    patches,
    context,
  });

  if (!(intensitySum > 0) || !Number.isFinite(intensitySum)) return 1;
  let broadbandVisibility = 0;
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const visibility = clamp01(transmittedSums[bandIndex] / intensitySum);
    broadbandVisibility += bands[bandIndex].weight * visibility;
  }
  return clamp01(broadbandVisibility);
}

function integrateDiskGrid(args: {
  starRadius: number;
  starRadiusSquared: number;
  gridSize: number;
  step: number;
  halfStep: number;
  limbDarkeningLaw: LimbDarkeningLaw | undefined;
  patches: ReturnType<typeof sanitizeBrightnessPatches>;
  context: SpectralIntegrationContext;
}): number {
  let intensitySum = 0;
  for (let iy = 0; iy < args.gridSize; iy++) {
    const y = -args.starRadius + args.halfStep + iy * args.step;
    const ySquared = y * y;
    for (let ix = 0; ix < args.gridSize; ix++) {
      const x = -args.starRadius + args.halfStep + ix * args.step;
      const radiusSquared = x * x + ySquared;
      if (radiusSquared > args.starRadiusSquared) continue;
      const intensity = diskIntensity(
        radiusSquared,
        args.starRadiusSquared,
        x,
        y,
        args.limbDarkeningLaw,
        args.patches,
      );
      if (intensity === 0) continue;
      intensitySum += intensity;
      accumulatePixelSpectra(x, y, intensity, args.context);
    }
  }
  return intensitySum;
}

function diskIntensity(
  radiusSquared: number,
  starRadiusSquared: number,
  x: number,
  y: number,
  limbDarkeningLaw: LimbDarkeningLaw | undefined,
  patches: ReturnType<typeof sanitizeBrightnessPatches>,
): number {
  const mu = Math.sqrt(Math.max(0, 1 - radiusSquared / starRadiusSquared));
  const baseIntensity = limbDarkeningLaw ? intensityNonNegative(mu, limbDarkeningLaw) : 1;
  const patch = patchFactorAt(x, y, patches, "multiply");
  const patchFactor = Number.isFinite(patch) ? Math.max(0, patch) : 1;
  const intensity = baseIntensity * patchFactor;
  return Number.isFinite(intensity) && intensity > 0 ? intensity : 0;
}

function accumulatePixelSpectra(
  x: number,
  y: number,
  intensity: number,
  context: SpectralIntegrationContext,
): void {
  for (let occulterIndex = 0; occulterIndex < context.occulters.length; occulterIndex++) {
    context.radii[occulterIndex] = Math.hypot(
      x - context.offsetsX[occulterIndex],
      y - context.offsetsY[occulterIndex],
    );
  }

  for (let bandIndex = 0; bandIndex < context.bands.length; bandIndex++) {
    context.transmittedSums[bandIndex] += intensity * pixelTransmissionForBand(bandIndex, context);
  }
}

function pixelTransmissionForBand(bandIndex: number, context: SpectralIntegrationContext): number {
  let totalTransmission = 1;
  for (let occulterIndex = 0; occulterIndex < context.occulters.length; occulterIndex++) {
    const occulter = context.occulters[occulterIndex];
    const rho = context.radii[occulterIndex];
    const radialTransmission = context.transmissions[bandIndex][occulterIndex];
    const rawTransmission = radialTransmission
      ? radialTransmission(rho)
      : rho <= occulter.r
        ? 1 - context.opacities[occulterIndex]
        : 1;
    totalTransmission *= Number.isFinite(rawTransmission) ? clamp01(rawTransmission) : 1;
    if (totalTransmission === 0) break;
  }
  return totalTransmission;
}
