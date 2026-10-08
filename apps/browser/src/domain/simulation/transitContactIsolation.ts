/** Isolates the nearest contact using a Lipschitz bound on the evaluated relative trajectory. */
export type TransitEventSampler = ((time: number) =>
  | {
      sky: { x: number; y: number; z: number };
      vSky: { x: number; y: number; z: number };
    }
  | undefined) & { speedBound?: number };

/** Negative only inside a front-side transit; continuous at the observer's horizon. */
export function transitContactValue(sampleAt: TransitEventSampler, time: number, radius: number): number {
  const sample = sampleAt(time);
  return sample ? Math.max(Math.hypot(sample.sky.x, sample.sky.y) - radius, -sample.sky.z) : NaN;
}

/**
 * Searches outward from an in-transit point. An interval is skipped only when its endpoint
 * distances and the supplied global speed bound exclude a crossing throughout the interval.
 * The guarantee is limited to the supplied trajectory/bound and the contact time tolerance.
 * Without a bound we return no certificate; callers must expose their fallback status.
 */
export function isolateNearestContact(
  sampleAt: TransitEventSampler,
  radius: number,
  seed: number,
  end: number,
): [number, number] | undefined {
  const speed = sampleAt.speedBound;
  if (!(speed !== undefined && Number.isFinite(speed) && speed > 0)) return undefined;
  const tolerance = Math.max(1e-7, 8 * Number.EPSILON * Math.max(Math.abs(seed), Math.abs(end)));
  let evaluations = 0;
  let exhausted = false;
  const value = (time: number) => {
    evaluations++;
    if (evaluations > 20000) {
      exhausted = true;
      return NaN;
    }
    const result = transitContactValue(sampleAt, time, radius);
    if (!Number.isFinite(result)) exhausted = true;
    return result;
  };
  const search = (a: number, fa: number, b: number, fb: number): [number, number] | undefined => {
    if (exhausted || !Number.isFinite(fa) || !Number.isFinite(fb)) return undefined;
    const width = Math.abs(b - a);
    if (Math.max(fa, fb) + (speed * width) / 2 < 0) return undefined;
    if (width <= tolerance) return fa < 0 && fb >= 0 ? [Math.min(a, b), Math.max(a, b)] : undefined;
    const mid = a + (b - a) / 2;
    if (mid === a || mid === b) return undefined;
    const fm = value(mid);
    return search(a, fa, mid, fm) ?? search(mid, fm, b, fb);
  };
  const bracket = search(seed, value(seed), end, value(end));
  return exhausted ? undefined : bracket;
}
