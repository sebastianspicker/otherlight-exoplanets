/** Linear drift of an orbit's orientation angles (node, inclination, periapsis) from a reference epoch. */
import type { OrbitElements } from "../model/types";
import { vCross, type Vec3 } from "./vec3";

export type OrbitOrientationDrift = {
  /** dΩ/dt [rad/s] (longitude of ascending node). */
  omegaDot?: number;
  /** di/dt [rad/s]. */
  incDot?: number;
  /** dω/dt [rad/s] (argument of periapsis). */
  omegaSmallDot?: number;
  /** Optional overrides of the base orientation at `tRefSec`. */
  Omega0?: number;
  inc0?: number;
  omega0?: number;
  /** Reference epoch [s]; defaults to 0. */
  tRefSec?: number;
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFiniteValue(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when any rate is finite and non-zero or any orientation override is finite. */
export function hasOrbitOrientationDrift(drift: OrbitOrientationDrift | undefined): boolean {
  if (!drift) return false;
  const rates = [drift.omegaDot, drift.incDot, drift.omegaSmallDot];
  const overrides = [drift.Omega0, drift.inc0, drift.omega0];
  return rates.some((rate) => isFiniteValue(rate) && rate !== 0) || overrides.some(isFiniteValue);
}

/**
 * Keeps an inclination inside [0, π] without changing the orientation: Rx(−i) equals
 * Rz(π) Rx(i) Rz(π), so a negative inclination is the same orbit with the node and the periapsis
 * advanced by π. The inclination is first reduced to (−π, π].
 */
function normalizeInclination(inc: number, Omega: number, omega: number): [number, number, number] {
  let reduced = inc % (2 * Math.PI);
  if (reduced > Math.PI) reduced -= 2 * Math.PI;
  if (reduced <= -Math.PI) reduced += 2 * Math.PI;
  return reduced < 0 ? [-reduced, Omega + Math.PI, omega + Math.PI] : [reduced, Omega, omega];
}

/**
 * Returns the orbit with its orientation advanced linearly to `tSec`. The input orbit is returned
 * unchanged (same reference) when the drift is empty; the node and periapsis angles are not
 * wrapped, while a drifted inclination is kept inside [0, π] by `normalizeInclination`.
 */
export function driftedOrbitElements(
  orbit: OrbitElements,
  drift: OrbitOrientationDrift,
  tSec: number,
): OrbitElements {
  if (!hasOrbitOrientationDrift(drift)) return orbit;
  const dt = tSec - finiteOr(drift.tRefSec, 0);
  const [inc, Omega, omega] = normalizeInclination(
    finiteOr(drift.inc0, orbit.inc) + finiteOr(drift.incDot, 0) * dt,
    finiteOr(drift.Omega0, orbit.Omega) + finiteOr(drift.omegaDot, 0) * dt,
    finiteOr(drift.omega0, orbit.omega) + finiteOr(drift.omegaSmallDot, 0) * dt,
  );
  return { ...orbit, Omega, inc, omega };
}

/**
 * Velocity from the changing orientation, Ω_frame × r, in the inertial frame.
 * Use the raw angles so inclination folding cannot reverse a rate or introduce a discontinuity.
 */
export function orbitOrientationVelocity(
  orbit: OrbitElements,
  drift: OrbitOrientationDrift,
  tSec: number,
  position: Vec3,
): Vec3 {
  const dt = tSec - finiteOr(drift.tRefSec, 0);
  const node = finiteOr(drift.Omega0, orbit.Omega) + finiteOr(drift.omegaDot, 0) * dt;
  const inc = finiteOr(drift.inc0, orbit.inc) + finiteOr(drift.incDot, 0) * dt;
  const incRate = finiteOr(drift.incDot, 0);
  const periRate = finiteOr(drift.omegaSmallDot, 0);
  return vCross(
    {
      x: incRate * Math.cos(node) + periRate * Math.sin(node) * Math.sin(inc),
      y: incRate * Math.sin(node) - periRate * Math.cos(node) * Math.sin(inc),
      z: finiteOr(drift.omegaDot, 0) + periRate * Math.cos(inc),
    },
    position,
  );
}
