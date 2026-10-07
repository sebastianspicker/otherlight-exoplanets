/** Resolves the primary star's (optionally evolving) surface map and its rotational modulation. */
import { evolveBrightnessPatches, spottedDiskFluxFactor } from "../../photometry/spotEvolution";
import type { VisibilityStarSurface } from "./nativePhotometryTypes";
import { resolveStarLimbDarkeningLaw } from "./nativePhotometryVisibility";
import type { NativeBodyState, NativeSnapshot } from "./nativeSnapshot";
import type { EducationScenarioV4 } from "./types";

/** Disk-integrated spot modulation S(t) applied to one star's luminosity. */
export type SpotModulation = { starId: string | undefined; factor: number };

// Brightness patches are painted on the primary star's projected disk (as the canvas draws them);
// with spot evolution enabled they rotate, foreshorten and decay with observer time.
const primaryPatchesAt = (config: EducationScenarioV4, primary: NativeBodyState, tObsSec: number) =>
  evolveBrightnessPatches({
    patches: config.photometry?.brightnessPatches,
    spotEvolution: config.photometry?.spotEvolution,
    rStar: primary.r,
    tSec: tObsSec,
  });

export const starSurfaceFor = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  star: NativeBodyState,
  tObsSec: number,
): VisibilityStarSurface | undefined =>
  star.id === snap.stars[0]?.id ? { brightnessPatches: primaryPatchesAt(config, star, tObsSec) } : undefined;

/** S(t) for the primary star; exactly 1 unless spot evolution is enabled (static patches). */
export const spotModulationFor = (
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
): SpotModulation => {
  const primary = snap.stars[0];
  if (!primary || config.photometry?.spotEvolution?.enabled !== true) {
    return { starId: primary?.id, factor: 1 };
  }
  const factor = spottedDiskFluxFactor({
    rStar: primary.r,
    patches: primaryPatchesAt(config, primary, tObsSec),
    limbDarkeningLaw: resolveStarLimbDarkeningLaw(config, primary),
    gridRes: config.photometry?.gridRes,
  });
  return { starId: primary.id, factor };
};

/** Star luminosity including the spot modulation; shared by every stellar flux sum. */
export const effectiveLuminosity = (star: NativeBodyState | undefined, modulation: SpotModulation): number =>
  (star?.luminosity ?? 0) * (star && star.id === modulation.starId ? modulation.factor : 1);
