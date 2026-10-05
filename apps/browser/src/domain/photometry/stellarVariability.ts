/** Models phenomenological stellar variability terms in normalized flux units. */
//
// Small out-of-transit stellar/system photometry terms (phenomenological):
// - Doppler beaming (a.k.a. Doppler boosting) ~ sin(phi)
// - Ellipsoidal variation ~ cos(2*phi)
// - Optional constant offset
//
// Scientific intent / scope:
// - Implements observer-space light-curve harmonics (not a physical RV + stellar-shape forward model).
// - Amplitudes are provided directly in "stellar flux units" relative to a normalized baseline ~1.0.
// - The harmonic phase phi is geometric, taken from the companion's position and velocity relative
//   to the star (see signedConjunctionPhaseRad in dayNightVisibility.ts):
//     z = (rRel . oHat) / |rRel|,  s = -(vRel . oHat) / vNorm,  phi = atan2(s, z)
//   with vNorm = n a / sqrt(1 - e^2) and n = 2π / period from the companion orbit.
//   phi = 0 at inferior conjunction (transit), phi = π at superior conjunction, and sin(phi) > 0
//   while the star approaches the observer. Beaming = A_b sin(phi + offset) is therefore zero at
//   both conjunctions and positive for an approaching star; ellipsoidal = -A_e cos(2(phi + offset))
//   has minima at both conjunctions and maxima at quadratures.
// - StellarVariabilityParams.phaseModel is kept for compatibility but no longer selects the phase;
//   both "linear-period" and "true-anomaly" use the geometric phase.
// - Without a companion state the harmonic terms are 0; constant, flare and pulsation terms remain.
//
// Stability / clamping policy:
// - Returns a small additive term, usually |f| << 1.
// - Applies a configurable stability clamp (default ±1e3) purely as a safety guard.

import type { OrbitElements, StellarVariabilityParams } from "../model/types";
import { clamp, isFiniteNumber, isFinitePositive } from "../model/units";
import type { Vec3 } from "../orbits/vec3";
import { signedConjunctionPhaseRad } from "./dayNightVisibility";
import {
  finiteOrZero,
  hasNoVariability,
  normalizeClampBounds,
  variabilityComponents,
  type StellarVariabilityComponents,
} from "./stellarVariabilityComponents";

/** Companion state relative to the varying star; observerDir points from the star toward the observer. */
export type StellarVariabilityGeometry = {
  rRel: Vec3;
  vRel: Vec3;
  observerDir: Vec3;
};

/** Velocity normalisation n a / sqrt(1 - e^2); undefined when the orbit cannot supply it. */
function orbitVelocityScale(orbit: OrbitElements | undefined): number | undefined {
  const period = orbit?.period;
  const a = orbit?.a;
  const e = isFiniteNumber(orbit?.e) ? orbit.e : 0;
  if (!isFinitePositive(period) || !isFinitePositive(a) || !(e >= 0 && e < 1)) return undefined;
  return (((2 * Math.PI) / period) * a) / Math.sqrt(1 - e * e);
}

function variabilityPhase(
  geometry: StellarVariabilityGeometry | undefined,
  orbit: OrbitElements | undefined,
): number | undefined {
  if (!geometry) return undefined;
  return signedConjunctionPhaseRad(
    geometry.rRel,
    geometry.vRel,
    geometry.observerDir,
    orbitVelocityScale(orbit),
  );
}

function harmonicVariabilityTerms(
  phi: number,
  model: StellarVariabilityParams,
  components: StellarVariabilityComponents,
): number {
  const beamingOffset = finiteOrZero(model.beamingOffset);
  const ellipOffset = finiteOrZero(model.ellipsoidalOffset);
  return (
    components.beamingAmp * Math.sin(phi + beamingOffset) -
    components.ellipAmp * Math.cos(2 * (phi + ellipOffset))
  );
}

function combineVariabilityTerms(
  phi: number | undefined,
  model: StellarVariabilityParams,
  components: StellarVariabilityComponents,
): number {
  return (
    components.constant +
    (phi === undefined ? 0 : harmonicVariabilityTerms(phi, model, components)) +
    components.flare +
    components.pulsations
  );
}

/**
 * Phenomenological stellar variability flux term (additive, in stellar units).
 *
 * Returns:
 * - Small additive value f_var(t), typically near 0.
 * - If model is disabled or invalid, returns 0.
 *
 * Robustness:
 * - Non-finite or nonsensical inputs produce 0 (safe no-op).
 * - A stability clamp is applied at the end (configurable).
 */
export function stellarVariabilityFlux(params: {
  t: number;
  orbit?: OrbitElements;
  model?: StellarVariabilityParams;
  geometry?: StellarVariabilityGeometry;
}): number {
  const model = params.model;
  if (!model?.enabled || !Number.isFinite(params.t)) return 0;

  const components = variabilityComponents(params.t, model);
  if (hasNoVariability(components)) return 0;

  const phi = variabilityPhase(params.geometry, params.orbit);
  const out = combineVariabilityTerms(phi, model, components);
  if (!Number.isFinite(out)) return 0;

  const { min, max } = normalizeClampBounds(model);
  return clamp(out, min, max);
}
