/** Computes native V4 stellar visibility and variability components. */
import { clamp01 } from "../../model/units";
import type { OrbitElements } from "../../model/types";
import { vSub } from "../../orbits/vec3";
import type { StellarVariabilityGeometry } from "../../photometry/stellarVariability";
import { stellarVariabilityFlux } from "../../photometry/stellarVariability";
import {
  photometricOcculterForBody,
  starVisibilityFromOcculters,
  starVisibilityFromOpaqueOcculters,
} from "./nativePhotometry";
import type { VisibilityOcculter, VisibilityRing } from "./nativePhotometryTypes";
import { oblateSilhouetteForBody } from "./nativeBodySilhouette";
import { starParentForBody } from "./nativeModelRelations";
import {
  effectiveLuminosity,
  type SpotModulation,
  spotModulationFor,
  starSurfaceFor,
} from "./nativeModelStellarSurface";
import type { NativeBodyState, NativeSnapshot } from "./nativeSnapshot";
import type { EducationScenarioV4, PlanetBodyV4 } from "./types";

export type VisibilityBundle = {
  byStar: Map<string, number>;
  byStarBinary: Map<string, number>;
  nOcculters: number;
};
export type StellarComponents = {
  stellarA: number;
  stellarB: number;
  stellarPreTransit: number;
  binaryEclipseFactor: number;
  stellarVariability: number;
  transitFactor: number;
};
type StellarSurfaceConfig = NonNullable<NonNullable<EducationScenarioV4["photometry"]>["stellarSurface"]>;

export const activeLuminousStars = (snap: NativeSnapshot): NativeBodyState[] =>
  snap.stars.filter((star) => star.active && star.luminosity > 0 && star.r > 0);
const activeOpaqueStars = (snap: NativeSnapshot): NativeBodyState[] =>
  snap.stars.filter((star) => star.active && star.r > 0);
export const activeNonStarOcculters = (snap: NativeSnapshot): NativeBodyState[] =>
  snap.bodies.filter((body) => body.kind !== "star" && body.active && body.r > 0);

export function computeVisibilityBundle(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  luminousStars: NativeBodyState[],
  nonStars: NativeBodyState[],
  tObsSec: number,
): VisibilityBundle {
  const byStar = new Map<string, number>();
  const byStarBinary = new Map<string, number>();
  const opaqueStars = activeOpaqueStars(snap);
  let nOcculters = 0;
  for (const star of luminousStars) {
    const frontStars = opaqueStars.filter((other) => other.id !== star.id && other.sky.z > star.sky.z);
    const visibility = visibilityForStar(config, snap, star, frontStars, nonStars, tObsSec);
    byStar.set(star.id, visibility.visible);
    byStarBinary.set(star.id, visibility.binaryVisible);
    nOcculters += visibility.nOcculters;
  }
  return { byStar, byStarBinary, nOcculters };
}

export function computeStellarComponents(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  luminousStars: NativeBodyState[],
  visibility: VisibilityBundle,
  tObsSec: number,
): StellarComponents {
  const spot = spotModulationFor(config, snap, tObsSec);
  const stellarBaseline = luminousStars.reduce((sum, star) => sum + effectiveLuminosity(star, spot), 0);
  const stellarFromBinaryEclipses = stellarFluxAfterBinaryEclipses(luminousStars, visibility, spot);
  const stellarVariability = stellarSurfaceVariability(config, snap, tObsSec);
  const stellarAfterAllOccultations = stellarFluxAfterAllOccultations(luminousStars, visibility, spot);
  const primaryBinaryVis = visibility.byStarBinary.get(snap.stars[0]?.id ?? "") ?? 1;
  const primaryAllVis = visibility.byStar.get(snap.stars[0]?.id ?? "") ?? 1;
  const stellarPreTransit = stellarFromBinaryEclipses + stellarVariability * primaryBinaryVis;
  const stellarAfterTransit = stellarAfterAllOccultations + stellarVariability * primaryAllVis;
  const stellarA = visibleStellarFlux(snap, visibility, spot, 0);
  const stellarB = visibleStellarFlux(snap, visibility, spot, 1);
  const eclipseFactor = binaryEclipseFactor(stellarBaseline, stellarFromBinaryEclipses);
  const transitFactor = transitFactorForStellarFlux(stellarPreTransit, stellarAfterTransit);
  return {
    stellarA,
    stellarB,
    binaryEclipseFactor: eclipseFactor,
    stellarVariability,
    stellarPreTransit,
    transitFactor,
  };
}

const binaryEclipseFactor = (stellarBaseline: number, stellarFromBinaryEclipses: number): number =>
  stellarBaseline > 0 ? clamp01(stellarFromBinaryEclipses / stellarBaseline) : 1;

const transitFactorForStellarFlux = (stellarPreTransit: number, stellarAfterTransit: number): number =>
  stellarPreTransit > 0 ? clamp01(stellarAfterTransit / stellarPreTransit) : 1;

const stellarFluxAfterBinaryEclipses = (
  luminousStars: NativeBodyState[],
  visibility: VisibilityBundle,
  spot: SpotModulation,
): number =>
  luminousStars.reduce(
    (sum, star) => sum + effectiveLuminosity(star, spot) * (visibility.byStarBinary.get(star.id) ?? 1),
    0,
  );

const stellarFluxAfterAllOccultations = (
  luminousStars: NativeBodyState[],
  visibility: VisibilityBundle,
  spot: SpotModulation,
): number =>
  luminousStars.reduce(
    (sum, star) => sum + effectiveLuminosity(star, spot) * (visibility.byStar.get(star.id) ?? 1),
    0,
  );

const visibilityForStar = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  star: NativeBodyState,
  frontStars: NativeBodyState[],
  nonStars: NativeBodyState[],
  tObsSec: number,
): { visible: number; binaryVisible: number; nOcculters: number } => {
  const surface = starSurfaceFor(config, snap, star, tObsSec);
  if (config.mode === "detached-binary-lab" && nonStars.length === 0) {
    const binaryVisible = starVisibilityFromOpaqueOcculters(config, star, frontStars, surface);
    return { visible: binaryVisible, binaryVisible, nOcculters: 0 };
  }
  const occulters = [...nonStars, ...frontStars];
  return {
    visible: starVisibilityFromOcculters(
      config,
      star,
      occulters
        .filter((occulter) => occulter.sky.z > star.sky.z)
        .map((occulter) => occulterShapeForBody(config, occulter)),
      surface,
    ),
    binaryVisible: starVisibilityFromOpaqueOcculters(config, star, frontStars, surface),
    nOcculters:
      star.id === snap.stars[0]?.id
        ? occulters.filter((occulter) => occulter.kind !== "star" && occulter.sky.z > star.sky.z).length
        : 0,
  };
};

const occulterShapeForBody = (config: EducationScenarioV4, body: NativeBodyState): VisibilityOcculter => {
  const occulter = photometricOcculterForBody(config, body);
  const ring = body.kind === "planet" ? visibilityRingForBody(body) : undefined;
  const ellipse = oblateSilhouetteForBody(config, body);
  return ring || ellipse
    ? { ...occulter, ...(ring ? { ring } : {}), ...(ellipse ? { ellipse } : {}) }
    : occulter;
};

// Ring radii are metres in the body frame, the same unit as sky-plane coordinates; a fully
// transparent ring is dropped so the circle-only fast paths still apply.
const visibilityRingForBody = (body: NativeBodyState): VisibilityRing | undefined => {
  const rings = body.source.rings;
  if (!rings) return undefined;
  const opacity = Number.isFinite(rings.opacity) ? clamp01(rings.opacity as number) : 1;
  const rInner = Number.isFinite(rings.innerRadius) ? Math.max(0, rings.innerRadius) : 0;
  if (!(opacity > 0 && Number.isFinite(rings.outerRadius) && rings.outerRadius > rInner)) return undefined;
  return { rInner, rOuter: rings.outerRadius, inc: rings.inclination, angle: rings.positionAngle, opacity };
};

const stellarSurfaceVariability = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
): number => {
  const surface = config.photometry?.stellarSurface;
  const companion = variabilityCompanion(config, snap);
  return (
    stellarVariabilityFlux({
      t: tObsSec,
      orbit: companion?.orbit,
      model: config.photometry?.stellarVariability,
      geometry: companion?.geometry,
    }) +
    granulationFlux(surface, tObsSec) +
    activityCycleFlux(surface, tObsSec)
  );
};

type VariabilityCompanion = { orbit: OrbitElements; geometry: StellarVariabilityGeometry };

// Beaming and ellipsoidal terms are phased from the first planet relative to its star; a system
// without planets uses the binary relative orbit (star B relative to star A).
const variabilityCompanion = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
): VariabilityCompanion | undefined => {
  const planet = snap.planets[0];
  const planetStar = planet ? starParentForBody(snap, planet, snap.stars[0]) : undefined;
  if (planet && planetStar) {
    return companionState(snap, planetStar, planet, (planet.source as PlanetBodyV4).orbit);
  }
  const [starA, starB] = snap.stars;
  return starA && starB ? companionState(snap, starA, starB, config.orbits.binary) : undefined;
};

const companionState = (
  snap: NativeSnapshot,
  star: NativeBodyState,
  companion: NativeBodyState,
  orbit: OrbitElements,
): VariabilityCompanion => ({
  orbit,
  geometry: {
    rRel: vSub(companion.rAbs, star.rAbs),
    vRel: vSub(companion.vAbs, star.vAbs),
    observerDir: snap.observerDir,
    vStar: star.vAbs,
    mStar: star.m,
    mCompanion: companion.m,
    rStar: star.r,
  },
});

const granulationFlux = (surface: StellarSurfaceConfig | undefined, tObsSec: number): number =>
  surface?.enabled && Number.isFinite(surface.granulationSigma)
    ? (surface.granulationSigma as number) *
      Math.sin((2 * Math.PI * tObsSec) / Math.max(1, surface.granulationTimescaleSec ?? 300))
    : 0;
const activityCycleFlux = (surface: StellarSurfaceConfig | undefined, tObsSec: number): number =>
  surface?.enabled &&
  Number.isFinite(surface.activityCyclePeriodSec) &&
  Number.isFinite(surface.activityCycleAmp)
    ? (surface.activityCycleAmp as number) *
      Math.sin((2 * Math.PI * tObsSec) / Math.max(1, surface.activityCyclePeriodSec as number))
    : 0;
const visibleStellarFlux = (
  snap: NativeSnapshot,
  visibility: VisibilityBundle,
  spot: SpotModulation,
  index: number,
): number =>
  effectiveLuminosity(snap.stars[index], spot) * (visibility.byStar.get(snap.stars[index]?.id ?? "") ?? 1);
