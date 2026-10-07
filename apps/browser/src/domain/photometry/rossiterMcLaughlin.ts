/** Computes the Rossiter–McLaughlin radial-velocity anomaly of a rigidly rotating, occulted star. */
//
// Rossiter–McLaughlin (RM) anomaly (Education V4 observable `rvStarRossiterMcLaughlin`).
//
// Geometry:
// - Sky plane with the star centred at (0,0), radius R, +y "up", observer along +z. Radial
//   velocities are positive when receding (same sign as `observables.rvStar`).
// - Rigid rotation with equatorial speed v_eq and spin axis inclined so that sin i_* is the
//   fraction of the axis lying in the sky plane. The projected axis has position angle lambda,
//   measured from +y toward +x.
// - Line-of-sight surface velocity (gradient perpendicular to the projected axis; for lambda = 0
//   the +x limb recedes):
//     v_los(x, y) = v_eq sin i_* (x cos lambda - y sin lambda) / R
//
// Anomaly:
// - The unocculted flux-weighted mean of v_los is 0 by symmetry, so the flux-weighted velocity
//   of the visible disk is
//     dRV = - ∫_blocked I v_los dA / (∫_disk I dA - ∫_blocked I dA)
//   with I the limb-darkened intensity (uniform without a law) times the brightness-patch factor
//   ("multiply" combination). Blocking receding light makes the star look approaching (dRV < 0).
// - Blocked = union of opaque circular occulters. Rings, oblate silhouettes and atmospheric
//   transmission are ignored (approximation).
//
// Numerics:
// - Midpoint integration on the shared disk grid (integrateDiskMidpoint, early exit disabled).
//   The integrator drops negative intensities, so the moment is integrated with the shifted,
//   non-negative weight I (v_los + V0), V0 = v_eq sin i_* >= |v_los|, and V0 ∫ I is subtracted.
// - Returns 0 when nothing overlaps or the visible flux vanishes; never NaN.

import type { BrightnessPatch } from "../model/typesPhotometrySurface";
import { integrateDiskMidpoint } from "./diskMidpoint";
import { intensityNonNegative, type LimbDarkeningLaw } from "./limbDarkening";
import { clampGridRes, sanitizeCircleOcculters, type CircleOcculter } from "./occulterCircle";
import { patchFactorAt, sanitizeBrightnessPatches } from "./patches";

export type RossiterMcLaughlinArgs = {
  /** Stellar radius (> 0). */
  rStar: number;
  /** Opaque circular occulters in front of the star, offsets relative to its centre. */
  occulters: CircleOcculter[];
  limbDarkeningLaw?: LimbDarkeningLaw;
  brightnessPatches?: BrightnessPatch[];
  gridRes?: number;
  /** Projected equatorial speed v_eq sin i_* [m/s]. */
  vEqSinI: number;
  /** Sky-plane position angle of the projected spin axis, from +y toward +x [rad]. */
  axisPositionAngleRad: number;
};

/** Flux-weighted RV anomaly [m/s] of the visible stellar disk; 0 without overlap. */
export function rossiterMcLaughlinVelocity(args: RossiterMcLaughlinArgs): number {
  const { rStar, vEqSinI, axisPositionAngleRad } = args;
  if (!(Number.isFinite(rStar) && rStar > 0)) return 0;
  if (!(Number.isFinite(vEqSinI) && Number.isFinite(axisPositionAngleRad)) || vEqSinI === 0) return 0;
  const occulters = sanitizeCircleOcculters(rStar, args.occulters);
  if (occulters.length === 0) return 0;
  const patches = sanitizeBrightnessPatches(args.brightnessPatches);
  const law = args.limbDarkeningLaw;
  const gridRes = clampGridRes(args.gridRes, 60);
  const cosL = Math.cos(axisPositionAngleRad);
  const sinL = Math.sin(axisPositionAngleRad);
  const v0 = Math.abs(vEqSinI);
  const intensity = (x: number, y: number, mu: number): number =>
    (law ? intensityNonNegative(mu, law) : 1) * patchFactorAt(x, y, patches, "multiply");
  const vLos = (x: number, y: number): number => (vEqSinI * (x * cosL - y * sinL)) / rStar;
  const plain = integrateDiskMidpoint({
    rStar,
    occulters,
    gridRes,
    intensityAt: ({ x, y, mu }) => intensity(x, y, mu),
  });
  const shifted = integrateDiskMidpoint({
    rStar,
    occulters,
    gridRes,
    intensityAt: ({ x, y, mu }) => intensity(x, y, mu) * Math.max(0, vLos(x, y) + v0),
  });
  const visible = plain.total - plain.blocked;
  if (!(visible > 1e-12 * plain.total)) return 0;
  const blockedMoment = shifted.blocked - v0 * plain.blocked;
  const dRv = -blockedMoment / visible;
  return Number.isFinite(dRv) ? dRv : 0;
}
