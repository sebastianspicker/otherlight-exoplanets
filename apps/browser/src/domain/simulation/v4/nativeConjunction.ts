/** Decides whether the primary star and its companion are at (inferior or superior) conjunction. */
import { vLen, vSub } from "../../orbits/vec3";
import { signedConjunctionPhaseRad } from "../../photometry/dayNightVisibility";
import { starParentForBody } from "./nativeModelRelations";
import type { NativeSnapshot } from "./nativeSnapshot";

/**
 * Conjunction is active when the companion's along-orbit displacement from the star-observer line,
 * |sin psi| * |rRel|, is within the combined radius. psi is the signed conjunction phase of the
 * first planet (or the second star) relative to the primary star; it fires at inferior and superior
 * conjunction for any inclination. Mirrored by the Swift engine.
 */
export function conjunctionActiveForSnapshot(snap: NativeSnapshot): boolean {
  const companion = snap.planets[0] ?? snap.stars[1];
  const star = companion ? starParentForBody(snap, companion, snap.stars[0]) : undefined;
  if (!star || !companion || star.id === companion.id) return false;
  const rRel = vSub(companion.rAbs, star.rAbs);
  const vRel = vSub(companion.vAbs, star.vAbs);
  const psi = signedConjunctionPhaseRad(rRel, vRel, snap.observerDir);
  if (psi === undefined) return false;
  return Math.abs(Math.sin(psi)) * vLen(rRel) <= star.r + companion.r;
}
