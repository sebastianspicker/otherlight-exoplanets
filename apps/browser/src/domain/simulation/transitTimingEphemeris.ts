/** Computes transit-center residuals against an explicit linear ephemeris. */
/** Returns an event center's residual against the nearest cycle of an explicit ephemeris. */
export function computeTtvSec(
  centerSec: number,
  periodSec?: number,
  referenceEpochSec?: number,
): number | undefined {
  if (!(Number.isFinite(periodSec) && (periodSec as number) > 0 && Number.isFinite(referenceEpochSec))) {
    return undefined;
  }
  const cycle = Math.floor((centerSec - (referenceEpochSec as number)) / (periodSec as number) + 0.5);
  const ephemerisCenter = (referenceEpochSec as number) + cycle * (periodSec as number);
  return Number.isFinite(ephemerisCenter) ? centerSec - ephemerisCenter : undefined;
}
