/** Resolves the primary star's rotation and spin geometry and its Rossiter–McLaughlin RV anomaly. */
//
// Rotation period P_rot: first finite positive of `star.spin.rotationPeriodSec`,
// `photometry.stellarSurface.rotationPeriodSec` (when stellarSurface is enabled) and
// `photometry.spotEvolution.rotationPeriodSec` (when spotEvolution is enabled). Without one the
// anomaly is undefined. Equatorial speed v_eq = 2π R / P_rot (rigid rotation).
//
// Spin axis: aligned with the orbital angular momentum of the first planet relative to the
// primary (else the binary companion), n = normalize(rRel × vRel), projected onto the sky basis.
// sin i_* = |n_sky,xy|; position angle lambda = atan2(n_sky.x, n_sky.y) unless
// `star.spin.axisPositionAngle` is authored (same convention). `star.spin.obliquity` is not used.
//
// Occulters: opaque circles (radius `body.r`) of active non-star bodies in front of the primary;
// rings, oblate silhouettes and atmospheric transmission are ignored.
import { projectToSky } from "../../orbits/frames";
import { vCross, vNormalizeOrZero, vSub } from "../../orbits/vec3";
import { isFinitePositive } from "../../model/units";
import { rossiterMcLaughlinVelocity } from "../../photometry/rossiterMcLaughlin";
import { activeNonStarOcculters } from "./nativeModelStellar";
import { starParentForBody } from "./nativeModelRelations";
import { starSurfaceFor } from "./nativeModelStellarSurface";
import { resolveStarLimbDarkeningLaw } from "./nativePhotometryVisibility";
import type { NativeSnapshot } from "./nativeSnapshot";
import type { EducationScenarioV4, StarBodyV4 } from "./types";

type StellarSpinGeometry = { sinI: number; axisPositionAngleRad: number };

/** Stellar rotation period [s], or undefined when none is authored or enabled. */
function stellarRotationPeriodSec(config: EducationScenarioV4, star: StarBodyV4): number | undefined {
  const surface = config.photometry?.stellarSurface;
  const spot = config.photometry?.spotEvolution;
  const candidates = [
    star.spin?.rotationPeriodSec,
    surface?.enabled === true ? surface.rotationPeriodSec : undefined,
    spot?.enabled === true ? spot.rotationPeriodSec : undefined,
  ];
  return candidates.find((value): value is number => isFinitePositive(value));
}

/** Projected spin geometry of the primary star; undefined without an orbiting companion. */
function stellarSpinGeometry(snap: NativeSnapshot): StellarSpinGeometry | undefined {
  const companion = snap.planets[0] ?? snap.stars[1];
  const star = companion ? starParentForBody(snap, companion, snap.stars[0]) : undefined;
  if (!star || !companion || star.id === companion.id) return undefined;
  const normal = vNormalizeOrZero(vCross(vSub(companion.rAbs, star.rAbs), vSub(companion.vAbs, star.vAbs)));
  const nSky = projectToSky(normal, snap.observerDir);
  const authoredAngle = (star.source as StarBodyV4).spin?.axisPositionAngle;
  const sinI = Math.hypot(nSky.x, nSky.y);
  if (!Number.isFinite(sinI)) return undefined;
  return {
    sinI,
    axisPositionAngleRad: Number.isFinite(authoredAngle)
      ? (authoredAngle as number)
      : Math.atan2(nSky.x, nSky.y),
  };
}

/** Rossiter–McLaughlin RV anomaly of the primary [m/s]; undefined without a rotation period. */
export function rossiterMcLaughlinForSnapshot(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
): number | undefined {
  const star = snap.stars[0];
  if (!star || star.kind !== "star" || !(star.r > 0)) return undefined;
  const periodSec = stellarRotationPeriodSec(config, star.source as StarBodyV4);
  if (periodSec === undefined) return undefined;
  const geometry = stellarSpinGeometry(snap);
  if (!geometry) return undefined;
  const vEq = (2 * Math.PI * star.r) / periodSec;
  const occulters = activeNonStarOcculters(snap)
    .filter((body) => body.sky.z > star.sky.z)
    .map((body) => ({ dx: body.sky.x - star.sky.x, dy: body.sky.y - star.sky.y, r: body.r }));
  return rossiterMcLaughlinVelocity({
    rStar: star.r,
    occulters,
    limbDarkeningLaw: resolveStarLimbDarkeningLaw(config, star),
    brightnessPatches: starSurfaceFor(config, snap, star, tObsSec)?.brightnessPatches,
    gridRes: config.photometry?.gridRes,
    vEqSinI: vEq * geometry.sinI,
    axisPositionAngleRad: geometry.axisPositionAngleRad,
  });
}
