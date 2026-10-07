/** Evolves projected brightness patches by rigid stellar rotation, decay and coverage. */
//
// Starspot evolution model (Education V4, enabled by `photometry.spotEvolution.enabled`).
//
// Geometry:
// - Sky plane with the star centred at (0,0), radius R, +y "up". The spin axis lies in the sky
//   plane along +y, so features move along x on lines of constant y.
// - Each authored patch is a surface feature defined by its projected centre (x0, y0) at the
//   reference epoch tRef (default 0):
//     latitude   phi     = asin(clamp(y0 / R, -1, 1))
//     longitude  lambda0 = asin(clamp(x0 / (R cos phi), -1, 1))   (pole: lambda0 = 0, fixed)
// - Longitude at time t (non-finite phase/drift count as 0; no rotation unless P_rot > 0):
//     lambda(t) = lambda0 + rotationPhase0 + 2π (t - tRef) / P_rot + drift (t - tRef)
// - Projected centre x(t) = R cos phi sin lambda(t), y(t) = y0; the feature is visible iff
//   cos lambda(t) > 0, otherwise it is dropped for that instant.
// - Foreshortening: with mu = sqrt(max(0, 1 - (x² + y²) / R²)) and mu0 the value at tRef
//   (floored at 1e-3 for features authored on the limb), a circle of radius r becomes an ellipse
//   with semi-axis rx = r min(1, mu / mu0) along the radial direction (angle = atan2(y, x)) and
//   ry = r: the authored extent is the feature's true size, so it only foreshortens toward the
//   limb and never inflates past r when a limb-authored feature rotates toward disk centre.
//   An authored ellipse is treated as a circle of equivalent radius sqrt(rx ry) (simplification).
//
// Contrast:
// - factor(t) = max(0, 1 + coverage (factor - 1) envelope(t)), coverage clamped to [0,1]
//   (default 1), envelope = exp(-max(0, t - tRef) / lifetime) for a finite positive lifetime,
//   else 1.
//
// Rotational modulation:
// - S(t) = ∫ I(mu) P(x,y,t) dA / ∫ I(mu) dA (limb darkening I, "multiply" patch combination) is
//   the disk-integrated flux of the spotted star relative to the same star without patches.
// - The `surface` field of BrightnessPatch is not used.

import { clamp, clamp01, isFinitePositive } from "../model/units";
import type { BrightnessPatch, SpotEvolutionParams } from "../model/typesPhotometrySurface";
import { integrateDiskMidpoint } from "./diskMidpoint";
import { intensityNonNegative, type LimbDarkeningLaw } from "./limbDarkening";
import { clampGridRes } from "./occulterCircle";
import { patchFactorAt, sanitizeBrightnessPatches } from "./patches";

const MU0_FLOOR = 1e-3;
const POLE_EPS = 1e-12;

type EvolutionState = {
  rotation: number;
  coverage: number;
  envelope: number;
};

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

const evolutionState = (spot: SpotEvolutionParams, tSec: number): EvolutionState => {
  const dt = tSec - finiteOr(spot.tRef, 0);
  const spin = isFinitePositive(spot.rotationPeriodSec) ? (2 * Math.PI) / spot.rotationPeriodSec : 0;
  const rotation = finiteOr(spot.rotationPhase0, 0) + spin * dt + finiteOr(spot.driftRateRadPerSec, 0) * dt;
  const envelope = isFinitePositive(spot.lifetimeSec) ? Math.exp(-Math.max(0, dt) / spot.lifetimeSec) : 1;
  return { rotation, coverage: clamp01(finiteOr(spot.coverage, 1)), envelope };
};

const equivalentRadius = (patch: BrightnessPatch): number =>
  patch.shape === "ellipse" ? Math.sqrt((patch.rx ?? NaN) * (patch.ry ?? NaN)) : (patch.r ?? NaN);

const projectedMu = (x: number, y: number, rStar: number): number =>
  Math.sqrt(Math.max(0, 1 - (x * x + y * y) / (rStar * rStar)));

const evolvedFactor = (factor: number, state: EvolutionState): number =>
  Math.max(0, 1 + state.coverage * (factor - 1) * state.envelope);

const evolvePatch = (
  patch: BrightnessPatch,
  rStar: number,
  state: EvolutionState,
): BrightnessPatch | undefined => {
  const r = equivalentRadius(patch);
  if (!Number.isFinite(patch.x) || !Number.isFinite(patch.y) || !isFinitePositive(r)) return undefined;
  const phi = Math.asin(clamp(patch.y / rStar, -1, 1));
  const cosPhi = Math.cos(phi);
  const factor = evolvedFactor(patch.factor, state);
  if (!(cosPhi > POLE_EPS)) return { shape: "circle", x: patch.x, y: patch.y, r, factor };
  const lambda = Math.asin(clamp(patch.x / (rStar * cosPhi), -1, 1)) + state.rotation;
  if (!(Math.cos(lambda) > 0)) return undefined;
  const x = rStar * cosPhi * Math.sin(lambda);
  const mu0 = Math.max(projectedMu(patch.x, patch.y, rStar), MU0_FLOOR);
  const rx = r * Math.min(1, projectedMu(x, patch.y, rStar) / mu0);
  return { shape: "ellipse", x, y: patch.y, rx, ry: r, angle: Math.atan2(patch.y, x), factor };
};

/**
 * Brightness patches at observer time `tSec` under the spot-evolution model.
 * Returns the input reference unchanged when evolution is disabled or the inputs are invalid,
 * otherwise the evolved patches on the visible hemisphere.
 */
export function evolveBrightnessPatches(args: {
  patches: BrightnessPatch[] | undefined;
  spotEvolution: SpotEvolutionParams | undefined;
  rStar: number;
  tSec: number;
}): BrightnessPatch[] | undefined {
  const { patches, spotEvolution, rStar, tSec } = args;
  if (spotEvolution?.enabled !== true || !patches || patches.length === 0) return patches;
  if (!isFinitePositive(rStar) || !Number.isFinite(tSec)) return patches;
  const state = evolutionState(spotEvolution, tSec);
  const out: BrightnessPatch[] = [];
  for (const patch of patches) {
    const evolved = patch ? evolvePatch(patch, rStar, state) : undefined;
    if (evolved) out.push(evolved);
  }
  return out;
}

/**
 * Disk-integrated flux of the patched star relative to the same star without patches,
 * S = ∫ I(mu) P dA / ∫ I(mu) dA. Returns 1 without valid patches or for a degenerate disk.
 */
export function spottedDiskFluxFactor(args: {
  rStar: number;
  patches: BrightnessPatch[] | undefined;
  limbDarkeningLaw: LimbDarkeningLaw | undefined;
  gridRes: number | undefined;
}): number {
  const patches = sanitizeBrightnessPatches(args.patches);
  if (patches.length === 0 || !isFinitePositive(args.rStar)) return 1;
  const law = args.limbDarkeningLaw;
  const intensity = (mu: number): number => (law ? intensityNonNegative(mu, law) : 1);
  const gridRes = clampGridRes(args.gridRes, 60);
  const unpatched = integrateDiskMidpoint({
    rStar: args.rStar,
    occulters: [],
    gridRes,
    intensityAt: ({ mu }) => intensity(mu),
  }).total;
  if (!(unpatched > 1e-12)) return 1;
  const patched = integrateDiskMidpoint({
    rStar: args.rStar,
    occulters: [],
    gridRes,
    intensityAt: ({ x, y, mu }) => intensity(mu) * patchFactorAt(x, y, patches, "multiply"),
  }).total;
  return Number.isFinite(patched) ? Math.max(0, patched / unpatched) : 1;
}
