/**
 * Estimates transit reference epochs and event times.
 */
import type { SkyPoint, StepEventTimingSolveDiagnostics } from "../model/types";
import { bisectRoot, findBracketByScan, findBracketsByScan } from "./transitTimingRoots";

type TransitEventEstimate = {
  centerSec: number;
  durationSec: number;
  ingressSec: number;
  egressSec: number;
  ttvSec?: number;
};

type TransitEventSolveResult = {
  event?: TransitEventEstimate;
  diagnostics: StepEventTimingSolveDiagnostics;
};

type TransitEventSample = {
  sky: SkyPoint;
  vSky: SkyPoint;
};

type LinearCenterProjection = {
  dtCenter: number;
  impactMin: number;
  zCenter: number;
};

function computeTtvSec(
  centerSec: number,
  periodSec?: number,
  referenceEpochSec?: number,
): number | undefined {
  if (!(Number.isFinite(periodSec) && (periodSec as number) > 0 && Number.isFinite(referenceEpochSec))) {
    return undefined;
  }
  const k = Math.floor((centerSec - (referenceEpochSec as number)) / (periodSec as number) + 0.5);
  const centerEphem = (referenceEpochSec as number) + k * (periodSec as number);
  return Number.isFinite(centerEphem) ? centerSec - centerEphem : undefined;
}

export function computeTransitReferenceEpochSec(args: {
  rStar: number;
  rBody: number;
  periodSec?: number;
  t0Sec?: number;
  sampleAt?: (tSec: number) => TransitEventSample | undefined;
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

function contactValueAt(sample: TransitEventSample | undefined, rSum: number): number | undefined {
  if (!sample) return undefined;
  const { sky } = sample;
  if (!Number.isFinite(sky.x) || !Number.isFinite(sky.y) || !Number.isFinite(sky.z)) return undefined;
  if (!(sky.z > 0)) return Number.POSITIVE_INFINITY;
  return Math.hypot(sky.x, sky.y) - rSum;
}

function centerDerivativeAt(sample: TransitEventSample | undefined): number | undefined {
  if (!sample) return undefined;
  const { sky, vSky } = sample;
  if (!isFiniteSkyPoint(sky) || !isFiniteSkyPoint(vSky)) return undefined;
  if (!(sky.z > 0)) return undefined;
  return sky.x * vSky.x + sky.y * vSky.y;
}

function solveTransitEventExact(args: {
  linear: TransitEventEstimate;
  tObsSec: number;
  rStar: number;
  rBody: number;
  sampleAt: (tSec: number) => TransitEventSample | undefined;
  periodSec?: number;
  transitReferenceEpochSec?: number;
}): TransitEventSolveResult {
  const { linear, tObsSec, rStar, rBody, sampleAt, periodSec, transitReferenceEpochSec } = args;
  const rSum = rStar + rBody;
  const maxSpanSec =
    Number.isFinite(periodSec) && (periodSec as number) > 0
      ? (periodSec as number) / 4
      : linear.durationSec * 8;
  const periodKnown = Number.isFinite(periodSec) && (periodSec as number) > 0;
  const halfPeriodSec = periodKnown ? (periodSec as number) / 2 : Number.POSITIVE_INFINITY;
  const baseSpanSec = Math.min(
    Math.max(linear.durationSec, Math.abs(linear.centerSec - tObsSec) * 2, 1e-3),
    Math.max(maxSpanSec, 1e-3),
  );
  const scanCenterSec = periodKnown
    ? Math.min(tObsSec + halfPeriodSec, Math.max(tObsSec - halfPeriodSec, linear.centerSec))
    : linear.centerSec;
  const scanWindows: { centerSec: number; spanSec: number }[] = [];
  for (let spanSec = baseSpanSec; spanSec <= Math.max(baseSpanSec, maxSpanSec); spanSec *= 2) {
    scanWindows.push({ centerSec: scanCenterSec, spanSec });
  }
  // Last resort: scan the whole half-period neighbourhood of the observation time.
  if (periodKnown) scanWindows.push({ centerSec: tObsSec, spanSec: halfPeriodSec });
  const validityFlags: string[] = [];
  let centerIterations = 0;
  let ingressIterations = 0;
  let egressIterations = 0;

  let centerSec = linear.centerSec;
  for (const window of scanWindows) {
    const centerFn = (trialSec: number) => centerDerivativeAt(sampleAt(trialSec));
    const { brackets } = findBracketsByScan({
      fn: centerFn,
      startSec: window.centerSec - window.spanSec,
      endSec: window.centerSec + window.spanSec,
      samples: 48,
    });
    let bestRootSec: number | undefined;
    for (const bracket of brackets) {
      const root = bisectRoot({
        fn: centerFn,
        leftSec: bracket[0],
        rightSec: bracket[1],
        tolSec: 1e-6,
        maxIters: 48,
      });
      centerIterations = Math.max(centerIterations, root.iterations);
      if (root.rootSec === undefined) continue;
      if (Math.abs(root.rootSec - tObsSec) > halfPeriodSec) continue;
      const contactAtRoot = contactValueAt(sampleAt(root.rootSec), rSum);
      if (!(contactAtRoot !== undefined && contactAtRoot < 0)) continue;
      if (bestRootSec === undefined || Math.abs(root.rootSec - tObsSec) < Math.abs(bestRootSec - tObsSec)) {
        bestRootSec = root.rootSec;
      }
    }
    if (bestRootSec !== undefined) {
      centerSec = bestRootSec;
      break;
    }
  }

  const contactCenter = contactValueAt(sampleAt(centerSec), rSum);
  if (!(contactCenter !== undefined && contactCenter < 0) || Math.abs(centerSec - tObsSec) > halfPeriodSec) {
    validityFlags.push("center-not-in-transit");
    return {
      event: linear,
      diagnostics: {
        status: "fallback-linear",
        converged: false,
        usedExact: true,
        centerIterations,
        ingressIterations,
        egressIterations,
        validityFlags,
      },
    };
  }

  let ingressBracket: [number, number] | undefined;
  let egressBracket: [number, number] | undefined;
  for (
    let spanSec = Math.min(Math.max(linear.durationSec, 1e-3), Math.max(maxSpanSec, 1e-3));
    spanSec <= Math.max(baseSpanSec, maxSpanSec);
    spanSec *= 2
  ) {
    ingressBracket =
      ingressBracket ??
      findBracketByScan({
        fn: (trialSec) => contactValueAt(sampleAt(trialSec), rSum),
        startSec: centerSec - spanSec,
        endSec: centerSec,
        samples: 64,
      }).bracket;
    egressBracket =
      egressBracket ??
      findBracketByScan({
        fn: (trialSec) => contactValueAt(sampleAt(trialSec), rSum),
        startSec: centerSec,
        endSec: centerSec + spanSec,
        samples: 64,
      }).bracket;
    if (ingressBracket && egressBracket) break;
  }

  if (!ingressBracket) validityFlags.push("ingress-bracket-miss");
  if (!egressBracket) validityFlags.push("egress-bracket-miss");
  if (!ingressBracket || !egressBracket) {
    return {
      event: linear,
      diagnostics: {
        status: "fallback-linear",
        converged: false,
        usedExact: true,
        centerIterations,
        ingressIterations,
        egressIterations,
        validityFlags,
      },
    };
  }

  const ingressRoot = bisectRoot({
    fn: (trialSec) => contactValueAt(sampleAt(trialSec), rSum),
    leftSec: ingressBracket[0],
    rightSec: ingressBracket[1],
    tolSec: 1e-6,
    maxIters: 48,
  });
  ingressIterations = ingressRoot.iterations;
  const egressRoot = bisectRoot({
    fn: (trialSec) => contactValueAt(sampleAt(trialSec), rSum),
    leftSec: egressBracket[0],
    rightSec: egressBracket[1],
    tolSec: 1e-6,
    maxIters: 48,
  });
  egressIterations = egressRoot.iterations;
  const ingressSec = ingressRoot.rootSec;
  const egressSec = egressRoot.rootSec;
  if (ingressSec === undefined) validityFlags.push("ingress-bisect-failed");
  if (egressSec === undefined) validityFlags.push("egress-bisect-failed");
  if (ingressSec === undefined || egressSec === undefined || !(egressSec > ingressSec)) {
    return {
      event: linear,
      diagnostics: {
        status: "fallback-linear",
        converged: false,
        usedExact: true,
        centerIterations,
        ingressIterations,
        egressIterations,
        validityFlags,
      },
    };
  }

  const exactCenterSec =
    centerDerivativeAt(sampleAt(centerSec)) !== undefined ? centerSec : (ingressSec + egressSec) / 2;
  if (centerDerivativeAt(sampleAt(centerSec)) === undefined) validityFlags.push("center-midpoint-fallback");
  return {
    event: {
      centerSec: exactCenterSec,
      durationSec: egressSec - ingressSec,
      ingressSec,
      egressSec,
      ttvSec: computeTtvSec(exactCenterSec, periodSec, transitReferenceEpochSec),
    },
    diagnostics: {
      status: "exact",
      converged: true,
      usedExact: true,
      centerIterations,
      ingressIterations,
      egressIterations,
      validityFlags,
    },
  };
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
  sampleAt?: (tSec: number) => TransitEventSample | undefined;
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
  sampleAt?: (tSec: number) => TransitEventSample | undefined;
}): TransitEventEstimate | undefined {
  return estimateTransitEventWithDiagnostics(args).event;
}
