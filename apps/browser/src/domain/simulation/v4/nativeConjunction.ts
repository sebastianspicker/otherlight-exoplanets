/** Decides whether the primary star and its companion are at (inferior or superior) conjunction. */
import { vDot, vLen, vScale, vSub } from "../../orbits/vec3";
import { starParentForBody } from "./nativeModelRelations";
import type { NativeSnapshot } from "./nativeSnapshot";

/**
 * Conjunction is an orbital phase marker, not an eclipse test: project the observer into the
 * instantaneous orbit plane and measure the companion's transverse displacement from that line.
 * Radial velocity must not affect this geometry. A face-on plane has no unique conjunction.
 * Mirrored by the Swift engine; non-eclipsing inclined orbits still have conjunctions.
 */
export function conjunctionActiveForSnapshot(snap: NativeSnapshot): boolean {
  const companion = snap.planets[0] ?? snap.stars[1];
  const star = companion ? starParentForBody(snap, companion, snap.stars[0]) : undefined;
  if (!star || !companion || star.id === companion.id) return false;
  const rRel = vSub(companion.rAbs, star.rAbs);
  const vRel = vSub(companion.vAbs, star.vAbs);
  const radius = vLen(rRel);
  if (!(radius > 0)) return false;
  const radial = vScale(rRel, 1 / radius);
  const transverse = vSub(vRel, vScale(radial, vDot(vRel, radial)));
  const speed = vLen(transverse);
  if (!(speed > 0)) return false;
  const cosPhase = vDot(radial, snap.observerDir);
  const sinPhase = vDot(vScale(transverse, 1 / speed), snap.observerDir);
  const projection = Math.hypot(cosPhase, sinPhase);
  return projection > 1e-12 && (Math.abs(sinPhase) / projection) * radius <= star.r + companion.r;
}
