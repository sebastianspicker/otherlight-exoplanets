/** Materializes native-engine body snapshots in the canonical SI observer frame. */
//
// Builds a NativeSnapshot containing the positions, velocities, and metadata of every
// body in the system at a given observer time. Snapshot construction is pure;
// it does not compute photometry.
//
// Kinematics: each authored Kepler orbit is a two-body relative orbit. A planet's orbit
// describes its subtree barycentre relative to its parent. Each subtree is split using
// its complete descendant mass, including the binary and circumbinary levels. Missing
// or non-positive masses are treated as zero in the educational compatibility path.

import { projectToSky } from "../../orbits/frames";
import {
  driftedOrbitElements,
  hasOrbitOrientationDrift,
  orbitOrientationVelocity,
} from "../../orbits/orbitOrientationDrift";
import { muFromPeriodAndA, type SolveKeplerEOptions } from "../../orbits/kepler";
import type { Vec3 } from "../../orbits/vec3";
import { vAdd, vScale, vSub } from "../../orbits/vec3";
import { posFromResolvedElements, stateFromResolvedElements } from "../orbits";
import {
  assertScientificBrowserSnapshotInputs,
  finiteOrDefault,
  hierarchyParentMap,
  keplerOptionsForExecutionMode,
  normalizeObserverDir,
  safeBodyRadius,
} from "./nativeSnapshotHelpers";
import type { MoonBodyV4, PlanetBodyV4, EducationScenarioV4, StarBodyV4 } from "./types";
import { resolveDetachedBinaryLuminosities } from "../../photometry/stellarBandFlux";
import { createScientificBrowserRuntimeError } from "./scientificErrors";

type NativeBodyKind = "star" | "planet" | "moon";

type OrbitState = {
  r: Vec3;
  v: Vec3;
};

export type NativeBodyState = {
  id: string;
  kind: NativeBodyKind;
  r: number;
  m: number;
  luminosity: number;
  active: boolean;
  parentId?: string;
  rAbs: Vec3;
  vAbs: Vec3;
  sky: { x: number; y: number; z: number };
  source: StarBodyV4 | PlanetBodyV4 | MoonBodyV4;
};

export type NativeSnapshot = {
  observerDir: Vec3;
  bodies: NativeBodyState[];
  stars: NativeBodyState[];
  planets: NativeBodyState[];
  moons: NativeBodyState[];
  byId: Map<string, NativeBodyState>;
};

export type ConservationBaseline = {
  energy?: number;
  angularMomentum?: number;
};

type SnapshotBuildContext = {
  config: EducationScenarioV4;
  tObsSec: number;
  observerDir: Vec3;
  keplerOpts?: SolveKeplerEOptions;
  byId: Map<string, NativeBodyState>;
  stars: NativeBodyState[];
  planets: NativeBodyState[];
  moons: NativeBodyState[];
  hmap: Map<string, string>;
  relByBody: Map<NativeBodyState, OrbitState>;
};

type BodyTranslation = {
  r: Vec3;
  v: Vec3;
};

type BinaryMassWeights = {
  starA: number;
  starB: number;
};

type OrbitingBodySource = PlanetBodyV4 | MoonBodyV4;

export function orbitStateAt(
  el: { a: number; e: number; inc: number; Omega: number; omega: number; period: number; t0: number },
  t: number,
  keplerOpts?: SolveKeplerEOptions,
): OrbitState {
  const mu = muFromPeriodAndA(el.period, el.a);
  if (Number.isFinite(mu) && mu > 0) {
    return stateFromResolvedElements(el, t, mu, "v4.orbit", keplerOpts);
  }
  // Fallback: central finite differences when mu cannot be derived (degenerate orbit).
  const dt = Math.max(0.01, el.period * 1e-4);
  const r = posFromResolvedElements(el, t, "v4.orbit", keplerOpts);
  const rp = posFromResolvedElements(el, t + dt, "v4.orbit", keplerOpts);
  const rm = posFromResolvedElements(el, t - dt, "v4.orbit", keplerOpts);
  return { r, v: vScale(vSub(rp, rm), 1 / (2 * dt)) };
}

function isScientificBrowser(config: EducationScenarioV4): boolean {
  return config.runtime?.executionMode === "scientific-browser";
}

function isDetachedBinaryLab(config: EducationScenarioV4): boolean {
  return config.mode === "detached-binary-lab";
}

function zeroVec(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

function scientificBrowserContext(config: EducationScenarioV4): {
  executionMode: string;
  runtimeMode: string;
} {
  return {
    executionMode: config.runtime?.executionMode ?? "interactive",
    runtimeMode: config.runtime?.mode ?? "realtime",
  };
}

function createSnapshotContext(config: EducationScenarioV4, tObsSec: number): SnapshotBuildContext {
  assertScientificBrowserSnapshotInputs(config);
  return {
    config,
    tObsSec,
    observerDir: normalizeObserverDir(config),
    keplerOpts: keplerOptionsForExecutionMode(config.runtime?.executionMode),
    byId: new Map<string, NativeBodyState>(),
    stars: [],
    planets: [],
    moons: [],
    hmap: hierarchyParentMap(config),
    relByBody: new Map<NativeBodyState, OrbitState>(),
  };
}

/** Includes every descendant before placing the two stellar subsystem barycentres. */
function binaryMassWeights(ctx: SnapshotBuildContext): BinaryMassWeights {
  const sources = [...ctx.config.bodies.planets, ...ctx.config.bodies.moons];
  const mass = (id: string, own: number, visiting = new Set<string>()): number => {
    if (visiting.has(id)) throw new Error("buildNativeSnapshot: cyclic hierarchy.");
    const path = new Set(visiting).add(id);
    return sources.reduce(
      (total, body) => {
        const parent =
          "parentPlanetId" in body
            ? (body.parentPlanetId ?? ctx.hmap.get(body.id))
            : planetParentId(ctx, body as PlanetBodyV4);
        return parent === id ? total + mass(body.id, finiteOrDefault(body.m, 0), path) : total;
      },
      Math.max(0, own),
    );
  };
  const [a, b] = ctx.config.bodies.stars;
  const mA = mass(a.id, finiteOrDefault(a.m, 0));
  const mB = mass(b.id, finiteOrDefault(b.m, 0));
  const total = mA + mB;
  return { starA: total > 0 ? -mB / total : 0, starB: total > 0 ? mA / total : 1 };
}

function detachedBinaryFallbackPassband(config: EducationScenarioV4): string | undefined {
  return isScientificBrowser(config) ? undefined : config.photometry?.limbDarkeningModel?.bandpass;
}

function secondaryFallbackLuminosityScale(config: EducationScenarioV4): number {
  if (isScientificBrowser(config)) return 0;
  return isDetachedBinaryLab(config) ? 0.3 : 0;
}

function detachedBinaryLuminosities(config: EducationScenarioV4, starA: StarBodyV4, starB: StarBodyV4) {
  return resolveDetachedBinaryLuminosities({
    primary: starA,
    secondary: starB,
    fallbackPassband: detachedBinaryFallbackPassband(config),
    secondaryFallbackLuminosityScale: secondaryFallbackLuminosityScale(config),
  });
}

function assertDetachedBinaryPhysicalLuminosities(config: EducationScenarioV4, source: string): void {
  if (!isScientificBrowser(config) || !isDetachedBinaryLab(config) || source === "physical-bandpass") return;
  throw createScientificBrowserRuntimeError({
    stage: "native-inputs",
    code: "SCB_BINARY_PHOTOMETRY_FALLBACK",
    summary: "native detached-binary scientific-browser snapshot requires physical bandpass weighting",
    details: [
      "detached-binary scientific-browser native snapshot rejects compatibility luminosity scaling",
      "provide explicit per-star physical photometry inputs (radius, teffK, passband)",
    ],
    context: scientificBrowserContext(config),
  });
}

function starStateFromBinary(
  star: StarBodyV4,
  binary: OrbitState,
  weight: number,
  luminosity: number,
  active: boolean,
  observerDir: Vec3,
): NativeBodyState {
  const rAbs = vScale(binary.r, weight);
  const vAbs = vScale(binary.v, weight);
  return {
    id: star.id,
    kind: "star",
    r: active ? safeBodyRadius(star) : 0,
    m: Math.max(0, finiteOrDefault(star.m, 0)),
    luminosity,
    active,
    rAbs,
    vAbs,
    sky: projectToSky(rAbs, observerDir),
    source: star,
  };
}

function addState(
  collection: NativeBodyState[],
  byId: Map<string, NativeBodyState>,
  state: NativeBodyState,
): void {
  byId.set(state.id, state);
  collection.push(state);
}

function addBinaryStarStates(ctx: SnapshotBuildContext): void {
  const [starA, starB] = ctx.config.bodies.stars;
  const binary = orbitStateAt(ctx.config.orbits.binary, ctx.tObsSec, ctx.keplerOpts);
  const weights = binaryMassWeights(ctx);
  const luminosities = detachedBinaryLuminosities(ctx.config, starA, starB);
  assertDetachedBinaryPhysicalLuminosities(ctx.config, luminosities.source);

  const starAState = starStateFromBinary(
    starA,
    binary,
    weights.starA,
    luminosities.primary,
    true,
    ctx.observerDir,
  );
  const starBActive = isDetachedBinaryLab(ctx.config) || luminosities.secondary > 0;
  const starBState = starStateFromBinary(
    starB,
    binary,
    weights.starB,
    starBActive ? luminosities.secondary : 0,
    starBActive,
    ctx.observerDir,
  );

  addState(ctx.stars, ctx.byId, starAState);
  addState(ctx.stars, ctx.byId, starBState);
}

function throwMissingMoonParent(config: EducationScenarioV4, bodyId: string): never {
  if (isScientificBrowser(config)) {
    throw createScientificBrowserRuntimeError({
      stage: "native-inputs",
      code: "SCB_INVALID_NATIVE_INPUTS",
      summary: "native snapshot inputs are invalid for scientific-browser execution",
      details: [`moon "${bodyId}" is missing a parent planet reference`],
      context: scientificBrowserContext(config),
    });
  }
  throw new Error(`buildNativeSnapshot: moon "${bodyId}" is missing a parent planet reference.`);
}

function throwUnknownParent(
  config: EducationScenarioV4,
  bodyKind: "planet" | "moon",
  bodyId: string,
  parentId: string,
): never {
  if (isScientificBrowser(config)) {
    throw createScientificBrowserRuntimeError({
      stage: "native-inputs",
      code: "SCB_INVALID_NATIVE_INPUTS",
      summary: "native snapshot inputs are invalid for scientific-browser execution",
      details: [`unknown parent "${parentId}" for ${bodyKind} "${bodyId}"`],
      context: scientificBrowserContext(config),
    });
  }
  throw new Error(`buildNativeSnapshot: unknown parent "${parentId}" for ${bodyKind} "${bodyId}".`);
}

function requireKnownParent(
  config: EducationScenarioV4,
  byId: Map<string, NativeBodyState>,
  bodyKind: "planet" | "moon",
  bodyId: string,
  parentId?: string,
): NativeBodyState | undefined {
  if (!parentId) {
    return bodyKind === "moon" ? throwMissingMoonParent(config, bodyId) : undefined;
  }
  const parent = byId.get(parentId);
  return parent ?? throwUnknownParent(config, bodyKind, bodyId, parentId);
}

function bodyBase(parent: NativeBodyState | undefined): { r: Vec3; v: Vec3 } {
  return parent ? { r: parent.rAbs, v: parent.vAbs } : { r: zeroVec(), v: zeroVec() };
}

function orbitingBodyState(
  ctx: SnapshotBuildContext,
  body: OrbitingBodySource,
  bodyKind: "planet" | "moon",
  parentId?: string,
  rel: OrbitState = orbitStateAt(body.orbit, ctx.tObsSec, ctx.keplerOpts),
): NativeBodyState {
  const parent = requireKnownParent(ctx.config, ctx.byId, bodyKind, body.id, parentId);
  const base = bodyBase(parent);
  const rAbs = vAdd(base.r, rel.r);
  const vAbs = vAdd(base.v, rel.v);
  const state: NativeBodyState = {
    id: body.id,
    kind: bodyKind,
    r: safeBodyRadius(body),
    m: Math.max(0, finiteOrDefault(body.m, 0)),
    luminosity: 0,
    active: true,
    parentId,
    rAbs,
    vAbs,
    sky: projectToSky(rAbs, ctx.observerDir),
    source: body,
  };
  ctx.relByBody.set(state, rel);
  return state;
}

function planetParentId(ctx: SnapshotBuildContext, p: PlanetBodyV4): string | undefined {
  const parentFromHierarchy = ctx.hmap.get(p.id);
  return p.parentSystem === "circumbinary"
    ? undefined
    : (p.parentStarId ?? parentFromHierarchy ?? ctx.config.bodies.stars[0].id);
}

function addPlanetState(ctx: SnapshotBuildContext, p: PlanetBodyV4): void {
  addState(ctx.planets, ctx.byId, orbitingBodyState(ctx, p, "planet", planetParentId(ctx, p)));
}

/** Evaluates moon position and its full time derivative, including orientation drift. */
function moonOrbitState(ctx: SnapshotBuildContext, moon: MoonBodyV4): OrbitState {
  const exo = ctx.config.dynamics?.exomoonTimingShape;
  if (!exo || exo.enabled !== true) return orbitStateAt(moon.orbit, ctx.tObsSec, ctx.keplerOpts);
  const drift = {
    omegaDot: exo.moonOmegaDot,
    incDot: exo.moonIncDot,
    omegaSmallDot: exo.moonOmegaSmallDot,
    Omega0: exo.moonOmega0,
    inc0: exo.moonInc0,
    omega0: exo.moonOmegaSmall0,
    tRefSec: exo.tRef,
  };
  if (!hasOrbitOrientationDrift(drift)) return orbitStateAt(moon.orbit, ctx.tObsSec, ctx.keplerOpts);
  const orbit = driftedOrbitElements(moon.orbit, drift, ctx.tObsSec);
  const rel = orbitStateAt(orbit, ctx.tObsSec, ctx.keplerOpts);
  return { r: rel.r, v: vAdd(rel.v, orbitOrientationVelocity(moon.orbit, drift, ctx.tObsSec, rel.r)) };
}

function addMoonState(ctx: SnapshotBuildContext, m: MoonBodyV4): void {
  const parentId = m.parentPlanetId ?? ctx.hmap.get(m.id);
  addState(ctx.moons, ctx.byId, orbitingBodyState(ctx, m, "moon", parentId, moonOrbitState(ctx, m)));
}

function childBodies(ctx: SnapshotBuildContext, parentId: string): NativeBodyState[] {
  return [...ctx.planets, ...ctx.moons].filter((body) => body.parentId === parentId);
}

/** Rigidly moves a body and every body hierarchically attached to it. */
function translateSubtree(
  ctx: SnapshotBuildContext,
  body: NativeBodyState,
  shift: BodyTranslation,
  visited: Set<NativeBodyState> = new Set(),
): void {
  if (visited.has(body)) return;
  visited.add(body);
  body.rAbs = vAdd(body.rAbs, shift.r);
  body.vAbs = vAdd(body.vAbs, shift.v);
  body.sky = projectToSky(body.rAbs, ctx.observerDir);
  childBodies(ctx, body.id).forEach((child) => translateSubtree(ctx, child, shift, visited));
}

/** Returns -sum(m_k rel_k) / mTotal for the given mass-weighted relative states. */
function weightedReflex(
  ctx: SnapshotBuildContext,
  members: { body: NativeBodyState; mass: number }[],
  mTotal: number,
): BodyTranslation {
  let r = zeroVec();
  let v = zeroVec();
  for (const { body, mass } of members) {
    const rel = ctx.relByBody.get(body)!;
    r = vAdd(r, vScale(rel.r, -mass / mTotal));
    v = vAdd(v, vScale(rel.v, -mass / mTotal));
  }
  return { r, v };
}

/** Splits each subtree from the leaves upward, preserving every authored relative orbit. */
function applyBarycentricMotion(ctx: SnapshotBuildContext): void {
  const split = (body: NativeBodyState): number => {
    const members = childBodies(ctx, body.id).map((child) => ({ body: child, mass: split(child) }));
    const total = members.reduce((sum, member) => sum + member.mass, body.m);
    if (total > 0) translateSubtree(ctx, body, weightedReflex(ctx, members, total));
    return total;
  };
  const stellarMass = ctx.stars.reduce((sum, star) => sum + split(star), 0);
  const outer = ctx.planets.filter((planet) => !planet.parentId).map((body) => ({ body, mass: split(body) }));
  const total = outer.reduce((sum, member) => sum + member.mass, stellarMass);
  if (total > 0 && outer.length > 0) {
    const shift = weightedReflex(ctx, outer, total);
    [...ctx.stars, ...outer.map((member) => member.body)].forEach((body) =>
      translateSubtree(ctx, body, shift),
    );
  }
}

/** Materializes parents first; cyclic and unresolved graphs fail rather than depend on array order. */
function addOrbitingStates(ctx: SnapshotBuildContext): void {
  const pending = new Map(ctx.config.bodies.planets.map((body) => [body.id, body]));
  while (pending.size > 0) {
    let progress = false;
    for (const [id, body] of pending) {
      const parent = planetParentId(ctx, body);
      if (parent && !ctx.byId.has(parent)) continue;
      addPlanetState(ctx, body);
      pending.delete(id);
      progress = true;
    }
    if (!progress) throw new Error("buildNativeSnapshot: cyclic or unresolved planet hierarchy.");
  }
  ctx.config.bodies.moons.forEach((moon) => addMoonState(ctx, moon));
  // Preserve authored display order; only evaluation order is topological.
  const order = new Map(ctx.config.bodies.planets.map((body, index) => [body.id, index]));
  ctx.planets.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

function buildSnapshotResult(ctx: SnapshotBuildContext): NativeSnapshot {
  const { observerDir, stars, planets, moons, byId } = ctx;

  return {
    observerDir,
    bodies: [...stars, ...planets, ...moons],
    stars,
    planets,
    moons,
    byId,
  };
}

/**
 * Materializes the native engine's immutable body snapshot at observed seconds in its canonical SI frame.
 * This boundary keeps hierarchy resolution and observer-frame state consistent for all native calculations.
 */
export function buildNativeSnapshot(config: EducationScenarioV4, tObsSec: number): NativeSnapshot {
  const ctx = createSnapshotContext(config, tObsSec);
  addBinaryStarStates(ctx);
  addOrbitingStates(ctx);
  applyBarycentricMotion(ctx);
  return buildSnapshotResult(ctx);
}
