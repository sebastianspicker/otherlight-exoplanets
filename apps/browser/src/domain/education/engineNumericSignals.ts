/**
 * Collects the numeric signals a lesson phase exposes.
 */
import type {
  LimbDarkeningLaw,
  StepResult,
  StepTimingDiagnostics,
  BrowserScenarioDraft,
} from "../model/types";
import { toFiniteNumber } from "../model/units";
import { resolveLimbDarkeningForBand } from "../photometry/limbDarkening";
import { intensityNonNegative } from "../photometry/limbDarkeningEvaluation";

export type NumericSignals = {
  bPlanet: number;
  bMoon: number;
  fluxTransitFactor: number;
  tdvRatio: number;
  rvStar: number;
  rvPlanet: number;
  depthApprox: number;
  depthObserved: number;
  combinedFluxDrop: number;
  moonLeadLagSec: number;
  /** k = R_p / R* (R_B / R_A in the binary lab). */
  radiusRatio: number;
  /** 1 + k: the body overlaps the stellar disk for b below this. */
  transitContactLimit: number;
  /** 1 - k: the occultation is total (or annular) for b below this. */
  totalEclipseLimit: number;
  /** 1 + R_m / R*: the moon overlaps the stellar disk for b_moon below this. */
  moonContactLimit: number;
  /** 1 - I(mu=0)/I(1) of the resolved law; u1 + u2 for the quadratic law. */
  limbDarkeningStrength: number;
  /** Mid-transit depth over the depth a quarter transit duration later (1 for a uniform disk). */
  transitCurvatureRatio: number;
  /** (R_m / R*)^2 while the moon is in front of the stellar disk, else 0. */
  moonCoveredFraction: number;
};

export type NumericSignalOptions = {
  /** Binary-lab lessons read depth from the combined two-star flux, not a planet proxy. */
  binary?: boolean;
};

function radiusRatio(system: BrowserScenarioDraft, bodyRadius: number | undefined): number {
  const rs = toFiniteNumber(system.star.r, Number.NaN);
  const rb = toFiniteNumber(bodyRadius, Number.NaN);
  return rs > 0 && rb >= 0 ? rb / rs : Number.NaN;
}

function resolveBaselineFlux(system: BrowserScenarioDraft, step: StepResult): number {
  const defaultBaseline = toFiniteNumber(system.star.photometry?.baselineFlux, 1);
  return toFiniteNumber(step.meta?.baselineFluxUsed, defaultBaseline);
}

function combinedFluxDrop(step: StepResult, baselineFlux: number): number {
  const displayFlux = toFiniteNumber(step.meta?.displayFluxValue, Number.NaN);
  if (Number.isFinite(displayFlux)) return Math.max(0, 1 - displayFlux);

  const fluxTotal = toFiniteNumber(step.fluxTotal, baselineFlux);
  return baselineFlux > 0 ? Math.max(0, 1 - fluxTotal / baselineFlux) : 0;
}

function stepTiming(step: StepResult): StepTimingDiagnostics | undefined {
  return step.meta?.observables?.timing ?? step.meta?.timing;
}

function finiteValue(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : Number.NaN;
}

// The moon is resolved in transit while the playback time lies between its star-relative
// contacts; the timing diagnostics are solved star-relative, so stellar reflex cancels.
function moonResolvedInTransit(step: StepResult): boolean {
  const timing = stepTiming(step);
  const tSec = toFiniteNumber(step.meta?.t, Number.NaN);
  return tSec >= finiteValue(timing?.moonIngressSec) && tSec <= finiteValue(timing?.moonEgressSec);
}

/**
 * Moon-vs-planet transit-centre offset from the timing diagnostics. It is only defined while
 * the moon is resolved in transit, so the linear event estimates far from transit can never
 * satisfy a lead/lag check.
 */
function moonLeadLagSec(step: StepResult): number {
  if (!moonResolvedInTransit(step)) return Number.NaN;
  const timing = stepTiming(step);
  return finiteValue(timing?.moonTransitCenterSec) - finiteValue(timing?.planetTransitCenterSec);
}

function finiteAbs(value: unknown): number {
  return Math.abs(toFiniteNumber(value, 0));
}

function resolvedLimbDarkeningLaw(system: BrowserScenarioDraft): LimbDarkeningLaw | undefined {
  const model = system.star.photometry?.limbDarkeningModel;
  return model ? resolveLimbDarkeningForBand(model) : undefined;
}

function limbIntensity(law: LimbDarkeningLaw | undefined, r: number): number {
  const mu = Math.sqrt(Math.max(0, 1 - r * r));
  return law ? intensityNonNegative(mu, law) : 1;
}

/**
 * Small-planet curvature proxy: the occulted intensity at mid-transit (r = b) over the occulted
 * intensity a quarter of the transit duration later, where the planet has covered half of the
 * chord half-length L = sqrt((1 + k)^2 - b^2). A uniform disk gives a flat bottom (ratio 1).
 */
function transitCurvatureRatio(law: LimbDarkeningLaw | undefined, b: number, k: number): number {
  if (!(Number.isFinite(b) && b < 1 && Number.isFinite(k) && k > 0)) return Number.NaN;
  const halfChord = Math.sqrt(Math.max(0, (1 + k) ** 2 - b * b));
  const quarterR = Math.hypot(b, halfChord / 2);
  const quarterIntensity = limbIntensity(law, quarterR);
  return quarterIntensity > 0 ? limbIntensity(law, b) / quarterIntensity : Number.NaN;
}

// The moon's own covered area adds to the geometric depth while it is in transit.
function moonCoveredFraction(system: BrowserScenarioDraft, step: StepResult): number {
  const k = radiusRatio(system, system.moon?.r);
  return k > 0 && moonResolvedInTransit(step) ? k * k : 0;
}

function geometrySignals(system: BrowserScenarioDraft, step: StepResult, bPlanet: number) {
  const k = radiusRatio(system, system.planet.r);
  const law = resolvedLimbDarkeningLaw(system);
  return {
    radiusRatio: k,
    transitContactLimit: 1 + k,
    totalEclipseLimit: 1 - k,
    moonContactLimit: 1 + radiusRatio(system, system.moon?.r),
    limbDarkeningStrength: 1 - limbIntensity(law, 1),
    transitCurvatureRatio: transitCurvatureRatio(law, bPlanet, k),
    moonCoveredFraction: moonCoveredFraction(system, step),
  };
}

/**
 * Extract the numeric signals used by rubric checks from the current system and step result.
 * All returned values are finite numbers or `Number.NaN` (never `undefined`).
 */
export function collectNumericSignals(
  system: BrowserScenarioDraft,
  step: StepResult,
  options: NumericSignalOptions = {},
): NumericSignals {
  const fluxTransitFactor = toFiniteNumber(step.fluxTransitFactor, 1);
  const combinedDrop = combinedFluxDrop(step, resolveBaselineFlux(system, step));
  const bPlanet = toFiniteNumber(step.meta?.bPlanet, Number.NaN);
  const geometry = geometrySignals(system, step, bPlanet);

  return {
    bPlanet,
    bMoon: toFiniteNumber(step.meta?.bMoon, Number.NaN),
    fluxTransitFactor,
    tdvRatio: toFiniteNumber(step.meta?.tdvRatio, Number.NaN),
    rvStar: finiteAbs(step.meta?.observables?.rvStar),
    rvPlanet: finiteAbs(step.meta?.observables?.rvPlanet),
    // Two luminous stars have no single (R_B/R_A)^2 depth prediction. A transiting moon
    // covers its own share of the disk, so the geometric depth counts it too.
    depthApprox: options.binary ? Number.NaN : geometry.radiusRatio ** 2 + geometry.moonCoveredFraction,
    depthObserved: options.binary ? combinedDrop : Math.max(0, 1 - fluxTransitFactor),
    combinedFluxDrop: combinedDrop,
    moonLeadLagSec: moonLeadLagSec(step),
    ...geometry,
  };
}
