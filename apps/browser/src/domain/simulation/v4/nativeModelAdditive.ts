/** Computes additive planetary and lunar flux contributions for native V4. */
import { clamp01 } from "../../model/units";
import type { PhaseCurveParams } from "../../model/types";
import { bodyPhaseFlux } from "../../photometry/phaseCurve";
import { vSub } from "../../orbits/vec3";
import { circleOverlapArea } from "./nativePhotometry";
import { starParentForBody, starParentForMoon } from "./nativeModelRelations";
import type { NativeBodyState, NativeSnapshot } from "./nativeSnapshot";
import type { MoonBodyV4, PlanetBodyV4, EducationScenarioV4 } from "./types";

export type VisibleFractions = {
  /** Visible fraction in [0, 1] of every planet and moon disk, keyed by body id. */
  byBody: Map<string, number>;
  planetVisibleFraction?: number;
  moonVisibleFraction?: number;
  /** Sky overlap of the first planet and moon divided by the smaller disk area (0 without a moon). */
  mutualOverlapFraction: number;
  /** Fraction of the first planet's disk hidden by stars alone (secondary eclipse). */
  planetStarOccultedFraction?: number;
  /** Fraction of the first moon's disk hidden by stars alone. */
  moonStarOccultedFraction?: number;
};

/** Sums planet phase flux, each term scaled by its visible fraction (bodies absent from the map count as 1). */
export const computeAdditivePlanetary = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  visibleByBody: Map<string, number>,
): number =>
  snap.planets.reduce(
    (sum, planet) =>
      sum +
      (visibleByBody.get(planet.id) ?? 1) *
        phaseFluxForBody(
          config,
          snap,
          planet,
          starParentForBody(snap, planet, snap.stars[0]),
          (planet.source as PlanetBodyV4).orbit.period,
          config.photometry?.phaseCurve,
        ),
    0,
  );
/** Sums moon phase flux, each term scaled by its visible fraction (bodies absent from the map count as 1). */
export const computeAdditiveLunar = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  visibleByBody: Map<string, number>,
): number =>
  snap.moons.reduce(
    (sum, moon) =>
      sum +
      (visibleByBody.get(moon.id) ?? 1) *
        phaseFluxForBody(
          config,
          snap,
          moon,
          starParentForMoon(snap, moon, snap.stars[0]),
          (moon.source as MoonBodyV4).orbit.period,
          config.photometry?.moonPhaseCurve,
        ),
    0,
  );

/**
 * Visible fraction of every planet and moon disk behind foreground occulters (stars, planets
 * and moons with larger sky.z). A star in front of a planet produces the secondary eclipse.
 */
export function computeVisibleFractions(snap: NativeSnapshot): VisibleFractions {
  const occulters = snap.bodies.filter((body) => body.active && body.r > 0);
  const byBody = new Map<string, number>();
  for (const body of [...snap.planets, ...snap.moons])
    byBody.set(body.id, bodyVisibleFraction(body, occulters));
  const planet = snap.planets[0];
  const moon = snap.moons[0];
  const stars = occulters.filter((body) => body.kind === "star");
  return {
    byBody,
    planetVisibleFraction: planet ? byBody.get(planet.id) : undefined,
    moonVisibleFraction: moon ? byBody.get(moon.id) : undefined,
    mutualOverlapFraction: planet && moon ? mutualOverlapFraction(planet, moon) : 0,
    planetStarOccultedFraction: planet ? 1 - bodyVisibleFraction(planet, stars) : undefined,
    moonStarOccultedFraction: moon ? 1 - bodyVisibleFraction(moon, stars) : undefined,
  };
}

// Projected overlap regardless of which body is in front, normalised by the smaller disk.
const mutualOverlapFraction = (a: NativeBodyState, b: NativeBodyState): number => {
  const smallerArea = Math.PI * Math.min(a.r, b.r) ** 2;
  if (!(smallerArea > 0)) return 0;
  const overlap = circleOverlapArea(a.r, b.r, Math.hypot(a.sky.x - b.sky.x, a.sky.y - b.sky.y));
  return clamp01(overlap / smallerArea);
};

// Product of per-occulter visible fractions. Exact for a single foreground occulter; when two
// occulters overlap the same body it treats their shadows as statistically independent instead
// of computing the exact union area, so it is an approximation in that rare case.
const bodyVisibleFraction = (body: NativeBodyState, occulters: NativeBodyState[]): number =>
  occulters.reduce((visible, occulter) => {
    if (occulter.id === body.id) return visible;
    const overlap = circleOverlapArea(
      body.r,
      occulter.r,
      Math.hypot(body.sky.x - occulter.sky.x, body.sky.y - occulter.sky.y),
    );
    return visible * (visibleFractionWhenOcculted(occulter, body, overlap) ?? 1);
  }, 1);

const phaseFluxForBody = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  body: NativeBodyState,
  parentStar: NativeBodyState | undefined,
  orbitPeriodSec: number,
  model: PhaseCurveParams | undefined,
): number => {
  const rel = parentStar ? vSub(body.rAbs, parentStar.rAbs) : body.rAbs;
  const vRel = parentStar ? vSub(body.vAbs, parentStar.vAbs) : body.vAbs;
  const photometry = config.photometry;
  return bodyPhaseFlux({
    rBody: rel,
    vBody: vRel,
    rBodyRadius: body.r,
    rStarRadius: parentStar?.r,
    observerDir: snap.observerDir,
    orbitPeriodSec,
    model,
    dayNightVisibility: photometry?.dayNightVisibility,
    thermalModelAdvanced: photometry?.thermalModelAdvanced,
  });
};

const visibleFractionWhenOcculted = (
  foreground: NativeBodyState,
  background: NativeBodyState,
  overlap: number,
): number | undefined => {
  const area = Math.PI * background.r * background.r;
  return foreground.sky.z > background.sky.z && area > 0 ? clamp01(1 - overlap / area) : undefined;
};
