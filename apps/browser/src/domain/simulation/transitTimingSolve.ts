/**
 * Estimates transit reference epochs and event times.
 */
import type { SkyPoint } from "../model/types";
import { solveTransitEventExact } from "./transitTimingExact";
import { computeTtvSec } from "./transitTimingEphemeris";
import type { TransitEventEstimate, TransitEventSolveResult } from "./transitTimingTypes";
import type { TransitEventSampler } from "./transitContactIsolation";

type LinearCenterProjection = {
  dtCenter: number;
  impactMin: number;
  zCenter: number;
};

export function computeTransitReferenceEpochSec(args: {
  rStar: number;
  rBody: number;
  periodSec?: number;
  t0Sec?: number;
  sampleAt?: TransitEventSampler;
}): number | undefined {
  const { rStar, rBody, periodSec, t0Sec, sampleAt } = args;
  if (!(Number.isFinite(periodSec) && (periodSec as number) > 0 && Number.isFinite(t0Sec) && sampleAt)) {
    return undefined;
  }

  const scanCount = 24;
  const halfWindowSec = (periodSec as number) / 2;
  let bestCenterSec: number | undefined;
  let bestDistanceSec = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= scanCount; index++) {
    const alpha = index / scanCount - 0.5;
    const trialSec = (t0Sec as number) + alpha * (periodSec as number);
    const sample = sampleAt(trialSec);
    if (!sample) continue;
    const event = estimateTransitEvent({
      tObsSec: trialSec,
      rStar,
      rBody,
      sky: sample.sky,
      vSky: sample.vSky,
      periodSec,
      sampleAt,
    });
    const centerSec = event?.centerSec;
    if (!Number.isFinite(centerSec)) continue;
    const distanceSec = Math.abs((centerSec as number) - (t0Sec as number));
    if (distanceSec > halfWindowSec + 1e-6 || distanceSec >= bestDistanceSec) continue;
    bestDistanceSec = distanceSec;
    bestCenterSec = centerSec;
  }

  return bestCenterSec;
}

function estimateTransitEventLinearized(args: {
  tObsSec: number;
  rStar: number;
  rBody: number;
  sky: SkyPoint;
  vSky: SkyPoint;
  periodSec?: number;
  transitReferenceEpochSec?: number;
}): TransitEventEstimate | undefined {
  const { tObsSec, rStar, rBody, sky, vSky, periodSec, transitReferenceEpochSec } = args;
  if (!hasValidLinearTransitInputs(rStar, rBody, sky, vSky)) return undefined;

  const speed2 = skyPlaneSpeedSquared(vSky);
  if (speed2 === undefined) return undefined;

  const center = projectLinearCenter(sky, vSky, speed2);
  const rSum = rStar + rBody;

  if (!isVisibleTransitCenter(center, rSum)) return undefined;

  const durationSec = linearTransitDurationSec(rSum, center.impactMin, speed2);
  if (durationSec === undefined) return undefined;

  const centerSec = tObsSec + center.dtCenter;
  const ingressSec = centerSec - durationSec / 2;
  const egressSec = centerSec + durationSec / 2;
  const ttvSec = computeTtvSec(centerSec, periodSec, transitReferenceEpochSec);

  return { centerSec, durationSec, ingressSec, egressSec, ttvSec };
}

function hasValidLinearTransitInputs(rStar: number, rBody: number, sky: SkyPoint, vSky: SkyPoint): boolean {
  return (
    Number.isFinite(rStar) &&
    rStar > 0 &&
    Number.isFinite(rBody) &&
    rBody > 0 &&
    isFiniteSkyPoint(sky) &&
    isFiniteSkyPoint(vSky)
  );
}

function isFiniteSkyPoint(sky: SkyPoint): boolean {
  return Number.isFinite(sky.x) && Number.isFinite(sky.y) && Number.isFinite(sky.z);
}

function skyPlaneSpeedSquared(vSky: SkyPoint): number | undefined {
  const speed2 = vSky.x * vSky.x + vSky.y * vSky.y;
  return speed2 > 0 ? speed2 : undefined;
}

function projectLinearCenter(sky: SkyPoint, vSky: SkyPoint, speed2: number): LinearCenterProjection {
  const dtCenter = -((sky.x * vSky.x + sky.y * vSky.y) / speed2);
  const xCenter = sky.x + vSky.x * dtCenter;
  const yCenter = sky.y + vSky.y * dtCenter;

  return {
    dtCenter,
    impactMin: Math.hypot(xCenter, yCenter),
    zCenter: sky.z + vSky.z * dtCenter,
  };
}

function isVisibleTransitCenter(center: LinearCenterProjection, rSum: number): boolean {
  return center.impactMin < rSum && center.zCenter > 0;
}

function linearTransitDurationSec(rSum: number, impactMin: number, speed2: number): number | undefined {
  const chord = Math.sqrt(Math.max(0, rSum * rSum - impactMin * impactMin)) * 2;
  const speed = Math.sqrt(speed2);
  return speed > 0 ? chord / speed : undefined;
}

export function estimateTransitEventWithDiagnostics(args: {
  tObsSec: number;
  rStar: number;
  rBody: number;
  sky: SkyPoint;
  vSky: SkyPoint;
  periodSec?: number;
  t0Sec?: number;
  transitReferenceEpochSec?: number;
  sampleAt?: TransitEventSampler;
}): TransitEventSolveResult {
  const linear = estimateTransitEventLinearized(args);
  if (!linear) {
    return {
      event: undefined,
      diagnostics: {
        status: "invalid-input",
        converged: false,
        usedExact: false,
        centerIterations: 0,
        ingressIterations: 0,
        egressIterations: 0,
        validityFlags: ["invalid-input"],
      },
    };
  }
  if (!args.sampleAt) {
    return {
      event: linear,
      diagnostics: {
        status: "linear-estimate",
        converged: false,
        usedExact: false,
        centerIterations: 0,
        ingressIterations: 0,
        egressIterations: 0,
        validityFlags: [],
      },
    };
  }
  return (
    solveTransitEventExact({
      linear,
      tObsSec: args.tObsSec,
      rStar: args.rStar,
      rBody: args.rBody,
      sampleAt: args.sampleAt,
      periodSec: args.periodSec,
      transitReferenceEpochSec: args.transitReferenceEpochSec,
    }) ?? {
      event: linear,
      diagnostics: {
        status: "fallback-linear",
        converged: false,
        usedExact: true,
        centerIterations: 0,
        ingressIterations: 0,
        egressIterations: 0,
        validityFlags: ["exact-solve-failed"],
      },
    }
  );
}

function estimateTransitEvent(args: {
  tObsSec: number;
  rStar: number;
  rBody: number;
  sky: SkyPoint;
  vSky: SkyPoint;
  periodSec?: number;
  t0Sec?: number;
  transitReferenceEpochSec?: number;
  sampleAt?: TransitEventSampler;
}): TransitEventEstimate | undefined {
  return estimateTransitEventWithDiagnostics(args).event;
}
