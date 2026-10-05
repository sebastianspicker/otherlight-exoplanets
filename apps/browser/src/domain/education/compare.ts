/**
 * Compares two scenarios at a time and interprets the result for teaching.
 */
import type { BrowserScenarioDraft } from "../model/types";
import { createSimulationV4, mapBrowserScenarioDraftToEducationScenarioV4 } from "../simulation/v4";
import type { EducationScenarioV4 } from "../simulation/v4/types";
import { displayFluxValueForConfig } from "../simulation/v4/binaryBaseline";
import type { SimulationFrame } from "../simulation/frames";
import { appendScalarDeltas, dynamicsNote, interpretationLine } from "./compareText";

type ComparisonCurvePoint = {
  t: number;
  flux: number;
};

type ComparisonCurveSeries = {
  id: string;
  label: string;
  color: string;
  style?: "solid" | "dashed" | "dotted";
  alpha?: number;
  width?: number;
  includeInLegend?: boolean;
  samples: ComparisonCurvePoint[];
};

type ComparisonInsetSeries = {
  label: string;
  color: string;
  samples: ComparisonCurvePoint[];
};

type ComparisonInset = {
  title: string;
  series: ComparisonInsetSeries[];
};

type ComparisonBadge = {
  label: string;
  color: string;
};

type ComparisonGhostGeometry = {
  label: string;
  color?: string;
  geometry: SimulationFrame["renderSignals"]["occulterGeometry"];
};

type SimulationRuntimeV4 = ReturnType<typeof createSimulationV4>;

/**
 * A/B scenario comparison result computed at a single simulation time `tSec`.
 * Captures scalar flux and RV deltas, plus optional visual overlays for the lesson UI.
 */
export type DidacticComparison = {
  tSec: number;
  fluxTotalDelta: number;
  fluxDisplayDelta?: number;
  fluxTransitDelta: number;
  rvStarDelta?: number;
  rvPlanetDelta?: number;
  visual?: {
    curveSeries: ComparisonCurveSeries[];
    comparisonInset?: ComparisonInset;
    sceneGhosts: ComparisonGhostGeometry[];
    badges: ComparisonBadge[];
  };
};

// The window is centred on the comparison time so the event being compared is always inside it.
function deriveComparisonWindow(
  stepA: SimulationFrame,
  stepB: SimulationFrame,
  tSec: number,
): { startSec: number; endSec: number } {
  const durationSec = Math.max(...durationCandidates(stepA, stepB), 1800);
  const extentSec = Math.max(...extentCandidates(stepA, stepB).map((eventSec) => offsetFrom(eventSec, tSec)));
  const halfWindowSec = Math.max(3600, durationSec * 3, extentSec + durationSec);
  return { startSec: tSec - halfWindowSec, endSec: tSec + halfWindowSec };
}

function absTimingValue(value: number | undefined): number {
  return Math.abs(value ?? 0);
}

function offsetFrom(eventSec: number | undefined, tSec: number): number {
  return Number.isFinite(eventSec) ? Math.abs((eventSec as number) - tSec) : 0;
}

function durationCandidates(stepA: SimulationFrame, stepB: SimulationFrame): number[] {
  return [
    absTimingValue(stepA.timing?.planetTransitDurationSec),
    absTimingValue(stepB.timing?.planetTransitDurationSec),
    absTimingValue(stepA.timing?.moonTransitDurationSec),
    absTimingValue(stepB.timing?.moonTransitDurationSec),
  ];
}

function extentCandidates(stepA: SimulationFrame, stepB: SimulationFrame): Array<number | undefined> {
  return [
    stepA.timing?.planetIngressSec,
    stepA.timing?.planetEgressSec,
    stepA.timing?.moonIngressSec,
    stepA.timing?.moonEgressSec,
    stepB.timing?.planetIngressSec,
    stepB.timing?.planetEgressSec,
    stepB.timing?.moonIngressSec,
    stepB.timing?.moonEgressSec,
  ];
}

function createGhost(label: string, step: SimulationFrame, color: string): ComparisonGhostGeometry {
  return {
    label,
    color,
    geometry: step.renderSignals.occulterGeometry.map((item) => ({ ...item })),
  };
}

function buildComparisonInset(
  aSamples: ComparisonCurvePoint[],
  bSamples: ComparisonCurvePoint[],
): ComparisonInset {
  const deltaSamples: ComparisonCurvePoint[] = [];
  const count = Math.min(aSamples.length, bSamples.length);
  for (let i = 0; i < count; i++) {
    deltaSamples.push({ t: aSamples[i].t, flux: bSamples[i].flux - aSamples[i].flux });
  }
  return {
    title: "A/B delta",
    series: [{ label: "B-A", color: "#ffb703", samples: deltaSamples }],
  };
}

function displayFluxForStep(step: SimulationFrame): number {
  return Number.isFinite(step.debug?.displayFluxValue)
    ? (step.debug?.displayFluxValue as number)
    : step.flux.total;
}

function sampleComparisonCurves(
  runtimeA: SimulationRuntimeV4,
  runtimeB: SimulationRuntimeV4,
  startSec: number,
  endSec: number,
): { aSamples: ComparisonCurvePoint[]; bSamples: ComparisonCurvePoint[] } {
  const sampleCount: number = 96;
  const aSamples: ComparisonCurvePoint[] = [];
  const bSamples: ComparisonCurvePoint[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const frac = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const tSample = startSec + frac * (endSec - startSec);
    aSamples.push({ t: tSample, flux: displayFluxForStep(runtimeA.step(tSample)) });
    bSamples.push({ t: tSample, flux: displayFluxForStep(runtimeB.step(tSample)) });
  }

  return { aSamples, bSamples };
}

function comparisonCurveSeries(
  aSamples: ComparisonCurvePoint[],
  bSamples: ComparisonCurvePoint[],
): ComparisonCurveSeries[] {
  return [
    {
      id: "compare-a",
      label: "scenario A",
      color: "#8ecae6",
      style: "solid",
      alpha: 0.85,
      samples: aSamples,
    },
    {
      id: "compare-b",
      label: "scenario B",
      color: "#f28482",
      style: "dashed",
      alpha: 0.9,
      samples: bSamples,
    },
  ];
}

function comparisonBadges(tSec: number, displayDelta: number): ComparisonBadge[] {
  return [
    { label: `compare @ ${tSec.toFixed(0)} s`, color: "#ffb703" },
    { label: `Δdisplay ${displayDelta.toExponential(1)}`, color: "#f4a261" },
  ];
}

function buildComparisonVisual(args: {
  tSec: number;
  displayDelta: number;
  sa: SimulationFrame;
  sb: SimulationFrame;
  aSamples: ComparisonCurvePoint[];
  bSamples: ComparisonCurvePoint[];
}): DidacticComparison["visual"] {
  return {
    curveSeries: comparisonCurveSeries(args.aSamples, args.bSamples),
    comparisonInset: buildComparisonInset(args.aSamples, args.bSamples),
    sceneGhosts: [
      createGhost("scenario A", args.sa, "rgba(142, 202, 230, 0.45)"),
      createGhost("scenario B", args.sb, "rgba(242, 132, 130, 0.42)"),
    ],
    badges: comparisonBadges(args.tSec, args.displayDelta),
  };
}

function finiteOrZero(value: number | undefined): number {
  return value ?? 0;
}

function fluxTransitDelta(sa: SimulationFrame, sb: SimulationFrame): number {
  return finiteOrZero(sb.flux.transitFactor) - finiteOrZero(sa.flux.transitFactor);
}

function rvStarDelta(sa: SimulationFrame, sb: SimulationFrame): number {
  return finiteOrZero(sb.observables?.rvStar) - finiteOrZero(sa.observables?.rvStar);
}

function rvPlanetDelta(sa: SimulationFrame, sb: SimulationFrame): number {
  return finiteOrZero(sb.observables?.rvPlanet) - finiteOrZero(sa.observables?.rvPlanet);
}

function comparisonFluxDisplayDelta(args: {
  configA: EducationScenarioV4;
  configB: EducationScenarioV4;
  sa: SimulationFrame;
  sb: SimulationFrame;
}): number {
  return (
    displayFluxValueForConfig(args.configB, args.sb.flux.total) -
    displayFluxValueForConfig(args.configA, args.sa.flux.total)
  );
}

/**
 * Run two already-mapped V4 scenarios at `tSec`, sample a comparison window centred on `tSec`,
 * and return a {@link DidacticComparison} with scalar deltas, curve series, and scene ghosts.
 * Callers map drafts through the application adapter so binary-lab scenarios keep their mode.
 */
export function compareScenarioConfigsAtTime(
  configA: EducationScenarioV4,
  configB: EducationScenarioV4,
  tSec: number,
): DidacticComparison {
  const runtimeA = createSimulationV4(configA);
  const runtimeB = createSimulationV4(configB);
  const sa = runtimeA.step(tSec);
  const sb = runtimeB.step(tSec);
  const { startSec, endSec } = deriveComparisonWindow(sa, sb, tSec);
  const { aSamples, bSamples } = sampleComparisonCurves(runtimeA, runtimeB, startSec, endSec);
  const fluxDisplayDelta = comparisonFluxDisplayDelta({ configA, configB, sa, sb });

  return {
    tSec,
    fluxTotalDelta: sb.flux.total - sa.flux.total,
    fluxDisplayDelta,
    fluxTransitDelta: fluxTransitDelta(sa, sb),
    rvStarDelta: rvStarDelta(sa, sb),
    rvPlanetDelta: rvPlanetDelta(sa, sb),
    visual: buildComparisonVisual({ tSec, displayDelta: fluxDisplayDelta, sa, sb, aSamples, bSamples }),
  };
}

/** Compares two preset-lab drafts (no binary branch) at `tSec`. */
export function compareScenariosAtTime(
  a: BrowserScenarioDraft,
  b: BrowserScenarioDraft,
  tSec: number,
): DidacticComparison {
  return compareScenarioConfigsAtTime(
    mapBrowserScenarioDraftToEducationScenarioV4(a),
    mapBrowserScenarioDraftToEducationScenarioV4(b),
    tSec,
  );
}

type CentreEstimator = (trialSec: number) => number | undefined;

const CENTRE_REFINE_MAX_ITERATIONS = 8;
const CENTRE_REFINE_TOLERANCE_SEC = 1;

// Near elongation the sky-plane tangent points almost a full cycle ahead, so a linear estimate
// counts only when it lands within a quarter period of its trial epoch. The estimate is then
// iterated to a fixed point (re-estimating from the previous estimate), which removes the
// extrapolation error; a candidate that does not settle is dropped.
function refinedCentreCandidate(
  centreAt: CentreEstimator,
  trialSec: number,
  periodSec: number | undefined,
): number | undefined {
  const estimateSec = centreAt(trialSec);
  if (!Number.isFinite(estimateSec)) return undefined;
  if (periodSec !== undefined && Math.abs((estimateSec as number) - trialSec) > periodSec / 4)
    return undefined;
  let centreSec = estimateSec as number;
  for (let iteration = 0; iteration < CENTRE_REFINE_MAX_ITERATIONS; iteration++) {
    const nextSec = centreAt(centreSec);
    if (!Number.isFinite(nextSec)) return undefined;
    const deltaSec = Math.abs((nextSec as number) - centreSec);
    centreSec = nextSec as number;
    if (deltaSec < CENTRE_REFINE_TOLERANCE_SEC) return centreSec;
  }
  return undefined;
}

/**
 * Returns the primary transit or eclipse centre nearest to `tSec` (trial epochs cover one
 * orbital period centred on `tSec`), or `tSec` itself when the scenario has no transiting body.
 */
export function nearestPrimaryTransitCentreSec(config: EducationScenarioV4, tSec: number): number {
  const runtime = createSimulationV4(config);
  const centreAt: CentreEstimator = (trialSec) => runtime.step(trialSec).timing?.planetTransitCenterSec;
  const rawPeriodSec = config.bodies.planets[0]?.orbit.period ?? config.orbits.binary.period;
  const periodSec = Number.isFinite(rawPeriodSec) && rawPeriodSec > 0 ? rawPeriodSec : undefined;
  const trialCount = periodSec === undefined ? 0 : 48;
  let bestSec = tSec;
  let bestDistanceSec = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= trialCount; index++) {
    const trialSec = periodSec === undefined ? tSec : tSec + (index / trialCount - 0.5) * periodSec;
    const centreSec = refinedCentreCandidate(centreAt, trialSec, periodSec);
    if (centreSec === undefined) continue;
    const distanceSec = Math.abs(centreSec - tSec);
    if (distanceSec < bestDistanceSec) {
      bestDistanceSec = distanceSec;
      bestSec = centreSec;
    }
  }
  return bestSec;
}

/**
 * Convert a {@link DidacticComparison} into a human-readable multi-line diagnostic string,
 * with optional lesson-specific interpretation if `context.lessonId` is set.
 */
export function interpretDidacticComparison(
  cmp: DidacticComparison,
  context?: { lessonId?: string; comparisonPrompt?: string },
): string {
  const lines: string[] = [];
  appendScalarDeltas(lines, cmp);

  const lessonId = context?.lessonId;
  lines.push(interpretationLine(cmp, lessonId));
  lines.push(dynamicsNote(cmp));

  if (context?.comparisonPrompt) {
    lines.push("");
    lines.push(`Lesson prompt: ${context.comparisonPrompt}`);
  }

  return lines.join("\n");
}
