/** Finds a front-side seed for bounded transit event isolation. */
import { bisectRoot, findBracketsByScan } from "./transitTimingRoots";
import { transitContactValue, type TransitEventSampler } from "./transitContactIsolation";
import type { TransitEventEstimate, TransitEventSample } from "./transitTimingTypes";

type ScanWindow = { centerSec: number; spanSec: number };
type RootSearch = { rootSec?: number; iterations: number };
type TransitCenterResult = {
  centerSec?: number;
  observedContact: number;
  iterations: number;
  validityFlags: string[];
};

/** Finds the selected front-side center, retaining the query when it is already in transit. */
export function findTransitCenter(args: {
  linear: TransitEventEstimate;
  tObsSec: number;
  rSum: number;
  periodSec?: number;
  sampleAt: TransitEventSampler;
}): TransitCenterResult {
  const { linear, tObsSec, rSum, periodSec, sampleAt } = args;
  const periodKnown = Number.isFinite(periodSec) && (periodSec as number) > 0;
  const halfPeriodSec = periodKnown ? (periodSec as number) / 2 : Number.POSITIVE_INFINITY;
  const observedContact = transitContactValue(sampleAt, tObsSec, rSum);
  let centerSec = observedContact < 0 ? tObsSec : linear.centerSec;
  let iterations = 0;
  if (!(observedContact < 0)) {
    for (const window of makeScanWindows(linear, tObsSec, periodSec)) {
      const root = nearestRootInWindow(window, tObsSec, halfPeriodSec, rSum, sampleAt);
      iterations = Math.max(iterations, root.iterations);
      if (root.rootSec !== undefined) {
        centerSec = root.rootSec;
        break;
      }
    }
  }
  const contact = transitContactValue(sampleAt, centerSec, rSum);
  const valid = contact < 0 && Math.abs(centerSec - tObsSec) <= halfPeriodSec;
  return {
    centerSec: valid ? centerSec : undefined,
    observedContact,
    iterations,
    validityFlags: valid ? [] : ["center-not-in-transit"],
  };
}

function makeScanWindows(linear: TransitEventEstimate, tObsSec: number, periodSec?: number): ScanWindow[] {
  const periodKnown = Number.isFinite(periodSec) && (periodSec as number) > 0;
  const maxSpanSec = periodKnown ? (periodSec as number) / 4 : linear.durationSec * 8;
  const halfPeriodSec = periodKnown ? (periodSec as number) / 2 : 0;
  const baseSpanSec = Math.min(
    Math.max(linear.durationSec, Math.abs(linear.centerSec - tObsSec) * 2, 1e-3),
    Math.max(maxSpanSec, 1e-3),
  );
  const centerSec = periodKnown
    ? Math.min(tObsSec + halfPeriodSec, Math.max(tObsSec - halfPeriodSec, linear.centerSec))
    : linear.centerSec;
  const windows: ScanWindow[] = [];
  for (let spanSec = baseSpanSec; spanSec <= Math.max(baseSpanSec, maxSpanSec); spanSec *= 2) {
    windows.push({ centerSec, spanSec });
  }
  if (periodKnown) windows.push({ centerSec: tObsSec, spanSec: halfPeriodSec });
  return windows;
}

function nearestRootInWindow(
  window: ScanWindow,
  tObsSec: number,
  halfPeriodSec: number,
  rSum: number,
  sampleAt: TransitEventSampler,
): RootSearch {
  const centerFn = (time: number) => centerDerivativeAt(sampleAt(time));
  const { brackets } = findBracketsByScan({
    fn: centerFn,
    startSec: window.centerSec - window.spanSec,
    endSec: window.centerSec + window.spanSec,
    samples: 48,
  });
  return selectNearestValidRoot(brackets, centerFn, tObsSec, halfPeriodSec, rSum, sampleAt);
}

function selectNearestValidRoot(
  brackets: Array<[number, number]>,
  centerFn: (time: number) => number | undefined,
  tObsSec: number,
  halfPeriodSec: number,
  rSum: number,
  sampleAt: TransitEventSampler,
): RootSearch {
  let bestRootSec: number | undefined;
  let iterations = 0;
  for (const bracket of brackets) {
    const root = bisectRoot({
      fn: centerFn,
      leftSec: bracket[0],
      rightSec: bracket[1],
      tolSec: 1e-6,
      maxIters: 48,
    });
    iterations = Math.max(iterations, root.iterations);
    if (root.rootSec === undefined || Math.abs(root.rootSec - tObsSec) > halfPeriodSec) continue;
    if (!(transitContactValue(sampleAt, root.rootSec, rSum) < 0)) continue;
    if (bestRootSec === undefined || Math.abs(root.rootSec - tObsSec) < Math.abs(bestRootSec - tObsSec)) {
      bestRootSec = root.rootSec;
    }
  }
  return { rootSec: bestRootSec, iterations };
}

function centerDerivativeAt(sample: TransitEventSample | undefined): number | undefined {
  if (!sample || !isFinitePoint(sample.sky) || !isFinitePoint(sample.vSky) || !(sample.sky.z > 0)) {
    return undefined;
  }
  return sample.sky.x * sample.vSky.x + sample.sky.y * sample.vSky.y;
}

function isFinitePoint(point: TransitEventSample["sky"]): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}
