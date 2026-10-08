/** Finds a front-side minimum without allowing tangent extrapolation outside its bracket. */
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

/** Golden-section minimization stays in the candidate's finite time bracket. */
function refineClosestApproach(
  sampleAt: SampleAt,
  coarse: ClosestApproach,
  left: number,
  right: number,
): ClosestApproach {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let best = coarse;
  let a = right - ratio * (right - left);
  let b = left + ratio * (right - left);
  let fa = frontSkySeparation(sampleAt(a));
  let fb = frontSkySeparation(sampleAt(b));
  for (let iteration = 0; iteration < 96 && right - left > 1e-7; iteration++) {
    if (fa < best.separation) best = { tSec: a, separation: fa };
    if (fb < best.separation) best = { tSec: b, separation: fb };
    if (fa <= fb) {
      right = b;
      b = a;
      fb = fa;
      a = right - ratio * (right - left);
      fa = frontSkySeparation(sampleAt(a));
    } else {
      left = a;
      a = b;
      fa = fb;
      b = left + ratio * (right - left);
      fb = frontSkySeparation(sampleAt(b));
    }
  }
  return best;
}

export function closestFrontApproach(
  sampleAt: SampleAt,
  startSec: number,
  endSec: number,
  samples: number,
  extraTimes: number[] = [],
): ClosestApproach | undefined {
  const times = [
    ...Array.from({ length: samples + 1 }, (_, i) => startSec + ((endSec - startSec) * i) / samples),
    ...extraTimes.filter((time) => time >= startSec && time <= endSec),
  ].sort((a, b) => a - b);
  const values = times.map((tSec) => ({ tSec, separation: frontSkySeparation(sampleAt(tSec)) }));
  let best: ClosestApproach | undefined;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value.separation)) continue;
    if (!best || value.separation < best.separation) best = value;
    if (
      i > 0 &&
      i + 1 < values.length &&
      value.separation <= values[i - 1].separation &&
      value.separation <= values[i + 1].separation
    ) {
      const refined = refineClosestApproach(sampleAt, value, times[i - 1], times[i + 1]);
      if (refined.separation < best.separation) best = refined;
    }
  }
  return best;
}
