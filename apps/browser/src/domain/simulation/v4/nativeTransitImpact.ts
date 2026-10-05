/**
 * Finds the closest front-of-star sky approach of a body over a time window.
 */
type SkyVector = { x: number; y: number; z: number };
type ProjectedSample = { sky: SkyVector; vSky: SkyVector };
type SampleAt = (trialSec: number) => ProjectedSample | undefined;

export type ClosestApproach = { tSec: number; separation: number };

function frontSkySeparation(sample: ProjectedSample | undefined): number {
  const sky = sample?.sky;
  if (!sky || !(sky.z > 0)) return Number.POSITIVE_INFINITY;
  const separation = Math.hypot(sky.x, sky.y);
  return Number.isFinite(separation) ? separation : Number.POSITIVE_INFINITY;
}

// Refines a sampled minimum with the linear centre projection dt = -(x vx + y vy) / |v|^2.
function refineClosestApproach(
  sampleAt: SampleAt,
  coarse: ClosestApproach,
  stepSec: number,
): ClosestApproach {
  let best = coarse;
  for (let iteration = 0; iteration < 4; iteration++) {
    const sample = sampleAt(best.tSec);
    const speed2 = sample ? sample.vSky.x ** 2 + sample.vSky.y ** 2 : 0;
    if (!sample || !(speed2 > 0)) break;
    const dtSec = -(sample.sky.x * sample.vSky.x + sample.sky.y * sample.vSky.y) / speed2;
    const tSec = Math.min(coarse.tSec + stepSec, Math.max(coarse.tSec - stepSec, best.tSec + dtSec));
    const separation = frontSkySeparation(sampleAt(tSec));
    if (!(separation < best.separation)) break;
    best = { tSec, separation };
  }
  return best;
}

export function closestFrontApproach(
  sampleAt: SampleAt,
  startSec: number,
  endSec: number,
  samples: number,
): ClosestApproach | undefined {
  const stepSec = (endSec - startSec) / samples;
  let best: ClosestApproach = { tSec: startSec, separation: Number.POSITIVE_INFINITY };
  for (let index = 0; index <= samples; index++) {
    const tSec = startSec + index * stepSec;
    const separation = frontSkySeparation(sampleAt(tSec));
    if (separation < best.separation) best = { tSec, separation };
  }
  return Number.isFinite(best.separation) ? refineClosestApproach(sampleAt, best, stepSec) : undefined;
}
