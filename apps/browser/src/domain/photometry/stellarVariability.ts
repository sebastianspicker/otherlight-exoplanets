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
// Physical amplitude mode (opt-in, physicalAmplitudes === true; Loeb & Gaudi 2003, Morris & Naftilan 1993):
// - Beaming: dF_beam = -beamingAlpha * 4 * RV_star / c with RV_star = -(vStar . oHat) (positive
//   receding), so an approaching star brightens. beamingOffset is ignored; without a finite vStar
//   the term is 0.
// - Ellipsoidal: dF_ell = -ellipsoidalAlpha * q * (rStar / |rRel|)^3 * sin^2 i * cos(2(phi + ellipsoidalOffset))
//   with q = mCompanion / mStar, sin^2 i = 1 - (nHat . oHat)^2 and nHat = normalize(rRel x vRel).
//   Minima at both conjunctions, maxima at quadrature. Without finite positive mStar and rStar, a
//   finite non-negative mCompanion and |rRel| > 0 the term is 0.
// - beamingAmp / ellipsoidalAmp are ignored; constant, flare, pulsations and the clamp still apply.
//
// Stability / clamping policy:
// - Returns a small additive term, usually |f| << 1.
// - Applies a configurable stability clamp (default ±1e3) purely as a safety guard.

import type { OrbitElements, StellarVariabilityParams } from "../model/types";
import { clamp, isFiniteNumber, isFinitePositive } from "../model/units";
import type { Vec3 } from "../orbits/vec3";
import { vCross, vDot, vIsFinite, vLen, vNormalizeOrZero } from "../orbits/vec3";
import { signedConjunctionPhaseRad } from "./dayNightVisibility";
import {
  finiteOrZero,
  hasNoVariability,
  normalizeClampBounds,
  variabilityComponents,
  type StellarVariabilityComponents,
} from "./stellarVariabilityComponents";

/**
 * Companion state relative to the varying star; observerDir points from the star toward the observer.
 * vStar (barycentric star velocity), masses [kg] and rStar [m] feed the physical amplitude mode only.
 */
export type StellarVariabilityGeometry = {
  rRel: Vec3;
  vRel: Vec3;
  observerDir: Vec3;
  vStar?: Vec3;
  mStar?: number;
  mCompanion?: number;
  rStar?: number;
};

const SPEED_OF_LIGHT_M_PER_S = 299792458;

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

function physicalBeamingTerm(model: StellarVariabilityParams, geometry: StellarVariabilityGeometry): number {
  const vStar = geometry.vStar;
  if (!vStar || !vIsFinite(vStar) || !vIsFinite(geometry.observerDir)) return 0;
  const oHat = vNormalizeOrZero(geometry.observerDir);
  if (!(vLen(oHat) > 0)) return 0;
  const rvStar = -vDot(vStar, oHat);
  const alpha = isFiniteNumber(model.beamingAlpha) ? model.beamingAlpha : 1;
  return (-alpha * 4 * rvStar) / SPEED_OF_LIGHT_M_PER_S;
}

function hasPhysicalEllipsoidalInputs(geometry: StellarVariabilityGeometry): boolean {
  return (
    isFinitePositive(geometry.mStar) &&
    isFiniteNumber(geometry.mCompanion) &&
    geometry.mCompanion >= 0 &&
    isFinitePositive(geometry.rStar) &&
    vLen(geometry.rRel) > 0
  );
}

function physicalEllipsoidalTerm(
  phi: number | undefined,
  model: StellarVariabilityParams,
  geometry: StellarVariabilityGeometry,
): number {
  if (phi === undefined || !hasPhysicalEllipsoidalInputs(geometry)) return 0;
  const q = (geometry.mCompanion as number) / (geometry.mStar as number);
  const ratio = (geometry.rStar as number) / vLen(geometry.rRel);
  const nHat = vNormalizeOrZero(vCross(geometry.rRel, geometry.vRel));
  const cosI = vDot(nHat, vNormalizeOrZero(geometry.observerDir));
  const sin2I = 1 - cosI * cosI;
  const alpha = isFiniteNumber(model.ellipsoidalAlpha) ? model.ellipsoidalAlpha : 1;
  const ellipOffset = finiteOrZero(model.ellipsoidalOffset);
  return -alpha * q * ratio ** 3 * sin2I * Math.cos(2 * (phi + ellipOffset));
}

function physicalHarmonicTerms(
  phi: number | undefined,
  model: StellarVariabilityParams,
  geometry: StellarVariabilityGeometry | undefined,
): number {
  if (!geometry) return 0;
  return physicalBeamingTerm(model, geometry) + physicalEllipsoidalTerm(phi, model, geometry);
}

function harmonicTerms(
  phi: number | undefined,
  model: StellarVariabilityParams,
  components: StellarVariabilityComponents,
  geometry: StellarVariabilityGeometry | undefined,
): number {
  if (model.physicalAmplitudes === true) return physicalHarmonicTerms(phi, model, geometry);
  return phi === undefined ? 0 : harmonicVariabilityTerms(phi, model, components);
}

function combineVariabilityTerms(harmonic: number, components: StellarVariabilityComponents): number {
  return components.constant + harmonic + components.flare + components.pulsations;
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
  // Physical mode evaluates beaming and ellipsoidal terms even when the amp knobs are 0.
  if (model.physicalAmplitudes !== true && hasNoVariability(components)) return 0;

  const phi = variabilityPhase(params.geometry, params.orbit);
  const out = combineVariabilityTerms(harmonicTerms(phi, model, components, params.geometry), components);
  if (!Number.isFinite(out)) return 0;

  const { min, max } = normalizeClampBounds(model);
  return clamp(out, min, max);
}
