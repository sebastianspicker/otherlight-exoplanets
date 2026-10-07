/** Coordinates native V4 snapshot construction and flux-bundle calculations. */
import {
  computeAdditiveLunar,
  computeAdditivePlanetary,
  computeVisibleFractions,
} from "./nativeModelAdditive";
import { computeRefraction, computeScatteringComponents } from "./nativeModelAtmosphere";
import {
  activeLuminousStars,
  activeNonStarOcculters,
  computeStellarComponents,
  computeVisibilityBundle,
} from "./nativeModelStellar";
import type { NativeSnapshot } from "./nativeSnapshot";
import type { EducationScenarioV4 } from "./types";

export { buildNativeSnapshot, orbitStateAt } from "./nativeSnapshot";
export type { ConservationBaseline, NativeBodyState, NativeSnapshot } from "./nativeSnapshot";

export type FluxBundle = {
  stellarA: number;
  stellarB: number;
  stellarPreTransit: number;
  binaryEclipseFactor: number;
  transitFactor: number;
  additivePlanetary: number;
  additiveLunar: number;
  forwardScattering: number;
  ringScattering: number;
  refraction: number;
  stellarVariability: number;
  total: number;
  nOcculters: number;
  planetVisibleFraction?: number;
  moonVisibleFraction?: number;
  mutualOverlapFraction: number;
  planetStarOccultedFraction?: number;
  moonStarOccultedFraction?: number;
};

export function computeFluxBundle(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
): FluxBundle {
  const luminousStars = activeLuminousStars(snap);
  const nonStars = activeNonStarOcculters(snap);
  const visibility = computeVisibilityBundle(config, snap, luminousStars, nonStars, tObsSec);
  const stellar = computeStellarComponents(config, snap, luminousStars, visibility, tObsSec);
  const visibleFractions = computeVisibleFractions(snap);
  const additivePlanetary = computeAdditivePlanetary(config, snap, visibleFractions.byBody);
  const additiveLunar = computeAdditiveLunar(config, snap, visibleFractions.byBody);
  const scattering = computeScatteringComponents(config, snap);
  const refraction = computeRefraction(config, snap);
  const transitFactor = stellar.transitFactor;
  const total =
    stellar.stellarPreTransit * transitFactor +
    additivePlanetary +
    additiveLunar +
    scattering.forwardScattering +
    scattering.ringScattering +
    refraction;
  return {
    stellarA: stellar.stellarA,
    stellarB: stellar.stellarB,
    stellarPreTransit: stellar.stellarPreTransit,
    binaryEclipseFactor: stellar.binaryEclipseFactor,
    transitFactor,
    additivePlanetary,
    additiveLunar,
    forwardScattering: scattering.forwardScattering,
    ringScattering: scattering.ringScattering,
    refraction,
    stellarVariability: stellar.stellarVariability,
    total,
    nOcculters: visibility.nOcculters,
    planetVisibleFraction: visibleFractions.planetVisibleFraction,
    moonVisibleFraction: visibleFractions.moonVisibleFraction,
    mutualOverlapFraction: visibleFractions.mutualOverlapFraction,
    planetStarOccultedFraction: visibleFractions.planetStarOccultedFraction,
    moonStarOccultedFraction: visibleFractions.moonStarOccultedFraction,
  };
}
