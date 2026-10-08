/**
 * Computes native V4 timing and observables for a step.
 */
import type {
  OrbitElements,
  StepEventTimingSolveBundle,
  StepObservables,
  StepTimingDiagnostics,
} from "../../model/types";
import { projectToSky } from "../../orbits/frames";
import { tdvRatioFromSkyPlaneSpeeds } from "../../orbits/exomoonTiming";
import type { Vec3 } from "../../orbits/vec3";
import { vIsFinite, vLenSq, vNormalizeOrZero, vSub } from "../../orbits/vec3";
import { orbitTimingKey } from "../orbitTimingKey";
import { computeTransitReferenceEpochSec, estimateTransitEventWithDiagnostics } from "../transitTimingSolve";
import { bodySampleAt, eccentricTimeKnots } from "./nativeTrajectoryBounds";
import type { TransitEventSampler } from "../transitContactIsolation";
import { closestFrontApproach, type ClosestApproach } from "./nativeTransitImpact";
import type { MoonBodyV4, PlanetBodyV4, EducationScenarioV4 } from "./types";
import { orbitStateAt, type NativeBodyState, type NativeSnapshot } from "./nativeModel";
import { conjunctionActiveForSnapshot } from "./nativeConjunction";
import { rossiterMcLaughlinForSnapshot } from "./nativeStellarSpin";

function sourceOrbit(body: NativeBodyState): OrbitElements | undefined {
  const src = body.source;
  return "orbit" in src ? (src as PlanetBodyV4 | MoonBodyV4).orbit : undefined;
}

const transitReferenceEpochCache = new WeakMap<EducationScenarioV4, Map<string, number | undefined>>();

// V4 timing mirrors sim/transitTimingSolve.ts, but works from NativeSnapshot bodies
// instead of BrowserScenarioDraft kinematics. The cache key includes full orbit fragments
// because binary-lab and scientific-browser modes can share period/t0 while
// changing orientation, hierarchy, or execution semantics.
function cachedTransitReferenceEpochSec(
  config: EducationScenarioV4,
  key: string,
  compute: () => number | undefined,
): number | undefined {
  let cache = transitReferenceEpochCache.get(config);
  if (!cache) {
    cache = new Map<string, number | undefined>();
    transitReferenceEpochCache.set(config, cache);
  }
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  cache.set(key, value);
  return value;
}

type RelativeSky = { x: number; y: number; z: number };

type ProjectedSample = {
  sky: RelativeSky;
  vSky: RelativeSky;
};

type TransitEstimate = ReturnType<typeof estimateTransitEventWithDiagnostics>;

type TimingAndObservables = {
  timing?: StepTimingDiagnostics;
  eventTimingConvergence?: StepEventTimingSolveBundle;
  observables?: StepObservables;
  bPlanet?: number;
  bMoon?: number;
  relPlanetSky: RelativeSky;
  relMoonSky?: RelativeSky;
  vPlanetSky?: number;
  vPlanetSkyRef?: number;
  tdvRatio?: number;
  conjunctionActive: boolean;
};

function usesExactTiming(config: EducationScenarioV4): boolean {
  return config.runtime?.executionMode === "scientific-browser";
}

function relativeSky(body: NativeBodyState, starRef: NativeBodyState): RelativeSky {
  return {
    x: body.sky.x - starRef.sky.x,
    y: body.sky.y - starRef.sky.y,
    z: body.sky.z - starRef.sky.z,
  };
}

function skyVelocity(body: NativeBodyState, starRef: NativeBodyState, obs: Vec3): RelativeSky {
  return projectToSky(vSub(body.vAbs, starRef.vAbs), obs);
}

function radialVelocity(v: Vec3, obs: Vec3): number {
  const d = vNormalizeOrZero(obs);
  if (!vIsFinite(v) || vLenSq(d) <= 0) return 0;
  return -(v.x * d.x + v.y * d.y + v.z * d.z);
}

function planetBody(snap: NativeSnapshot): NativeBodyState {
  return snap.planets[0] ?? snap.stars[1];
}

function isBinaryStarBody(snap: NativeSnapshot, body: NativeBodyState): boolean {
  return body.id === snap.stars[1]?.id;
}

type SampleAt = TransitEventSampler;

function exactSampleAt(
  config: EducationScenarioV4,
  obs: Vec3,
  selectBody: (snap: NativeSnapshot) => NativeBodyState | undefined,
): SampleAt | undefined {
  return usesExactTiming(config) ? bodySampleAt(config, obs, selectBody) : undefined;
}

function planetPeriodSec(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  planet: NativeBodyState,
): number | undefined {
  return (
    sourceOrbit(planet)?.period ?? (isBinaryStarBody(snap, planet) ? config.orbits.binary.period : undefined)
  );
}

function planetT0Sec(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  planet: NativeBodyState,
): number | undefined {
  return sourceOrbit(planet)?.t0 ?? (isBinaryStarBody(snap, planet) ? config.orbits.binary.t0 : undefined);
}

function planetReferenceEpochKey(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
): string {
  return [
    "planet",
    starRef.r,
    planet.r,
    orbitTimingKey("orbit", sourceOrbit(planet) ?? config.orbits.binary),
    orbitTimingKey("binary", config.orbits.binary),
    snap.observerDir.x,
    snap.observerDir.y,
    snap.observerDir.z,
    config.mode,
    config.runtime?.executionMode ?? "",
  ].join(":");
}

function moonReferenceEpochKey(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  moon: NativeBodyState,
  planet: NativeBodyState,
): string {
  return [
    "moon",
    starRef.r,
    moon.r,
    planet.r,
    orbitTimingKey("moon-orbit", sourceOrbit(moon)),
    JSON.stringify(config.dynamics?.exomoonTimingShape ?? null),
    orbitTimingKey("planet-orbit", sourceOrbit(planet) ?? config.orbits.binary),
    orbitTimingKey("binary", config.orbits.binary),
    snap.observerDir.x,
    snap.observerDir.y,
    snap.observerDir.z,
    config.mode,
    config.runtime?.executionMode ?? "",
  ].join(":");
}

function planetTransitReferenceEpochSec(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
  sampleAt: ((trialSec: number) => ProjectedSample | undefined) | undefined,
): number | undefined {
  return cachedTransitReferenceEpochSec(config, planetReferenceEpochKey(config, snap, starRef, planet), () =>
    computeTransitReferenceEpochSec({
      rStar: starRef.r,
      rBody: planet.r,
      periodSec: planetPeriodSec(config, snap, planet),
      t0Sec: planetT0Sec(config, snap, planet),
      sampleAt,
    }),
  );
}

function moonTransitReferenceEpochSec(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  moon: NativeBodyState,
  planet: NativeBodyState,
  sampleAt: ((trialSec: number) => ProjectedSample | undefined) | undefined,
): number | undefined {
  // Moon transits recur with the planet's orbital cycle, not the moon's own period.
  return cachedTransitReferenceEpochSec(
    config,
    moonReferenceEpochKey(config, snap, starRef, moon, planet),
    () =>
      computeTransitReferenceEpochSec({
        rStar: starRef.r,
        rBody: moon.r,
        periodSec: planetPeriodSec(config, snap, planet),
        t0Sec: planetT0Sec(config, snap, planet),
        sampleAt,
      }),
  );
}

function estimatePlanetEvent(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
  tObsSec: number,
  sampleAt: SampleAt | undefined,
): TransitEstimate {
  const sky = relativeSky(planet, starRef);
  return estimateTransitEventWithDiagnostics({
    tObsSec,
    rStar: starRef.r,
    rBody: planet.r,
    sky,
    vSky: skyVelocity(planet, starRef, snap.observerDir),
    periodSec: planetPeriodSec(config, snap, planet),
    t0Sec: planetT0Sec(config, snap, planet),
    transitReferenceEpochSec: planetTransitReferenceEpochSec(config, snap, starRef, planet, sampleAt),
    sampleAt,
  });
}

function estimateMoonEvent(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
  moon: NativeBodyState | undefined,
  tObsSec: number,
  sampleAt: SampleAt | undefined,
): TransitEstimate | undefined {
  if (!moon) return undefined;
  return estimateTransitEventWithDiagnostics({
    tObsSec,
    rStar: starRef.r,
    rBody: moon.r,
    sky: relativeSky(moon, starRef),
    vSky: skyVelocity(moon, starRef, snap.observerDir),
    periodSec: planetPeriodSec(config, snap, planet),
    t0Sec: planetT0Sec(config, snap, planet),
    transitReferenceEpochSec: moonTransitReferenceEpochSec(config, snap, starRef, moon, planet, sampleAt),
    sampleAt,
  });
}

function timingDiagnostics(
  pEvent: TransitEstimate,
  mEvent: TransitEstimate | undefined,
): StepTimingDiagnostics | undefined {
  return pEvent.event || mEvent?.event
    ? {
        planetTransitCenterSec: pEvent.event?.centerSec,
        planetTransitDurationSec: pEvent.event?.durationSec,
        planetIngressSec: pEvent.event?.ingressSec,
        planetEgressSec: pEvent.event?.egressSec,
        planetTtvSec: pEvent.event?.ttvSec,
        moonTransitCenterSec: mEvent?.event?.centerSec,
        moonTransitDurationSec: mEvent?.event?.durationSec,
        moonIngressSec: mEvent?.event?.ingressSec,
        moonEgressSec: mEvent?.event?.egressSec,
        moonTtvSec: mEvent?.event?.ttvSec,
      }
    : undefined;
}

function eventTimingConvergence(
  pEvent: TransitEstimate,
  mEvent: TransitEstimate | undefined,
): StepEventTimingSolveBundle {
  return {
    planet: pEvent.diagnostics,
    moon: mEvent?.diagnostics,
  };
}

// An explicit finite tRef wins; otherwise TDV is referenced to the planet's transit epoch.
function exomoonTimingReferenceSec(
  config: EducationScenarioV4,
  planetTransitReferenceSec: number | undefined,
): number | undefined {
  const rawTRef = config.dynamics?.exomoonTimingShape?.tRef;
  if (typeof rawTRef === "number" && Number.isFinite(rawTRef)) return rawTRef;
  if (!usesExactTiming(config)) return planetTransitReferenceSec ?? 0;
  return planetTransitReferenceSec;
}

function planetReferenceOrbit(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  planet: NativeBodyState,
): OrbitElements {
  return isBinaryStarBody(snap, planet)
    ? config.orbits.binary
    : (sourceOrbit(planet) ?? config.orbits.binary);
}

function planetReferenceSkyVelocity(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
  referenceSampleAt: SampleAt,
): number | undefined {
  const rawTRef = config.dynamics?.exomoonTimingShape?.tRef;
  const explicitTRef = typeof rawTRef === "number" && Number.isFinite(rawTRef);
  const tRef = exomoonTimingReferenceSec(
    config,
    // Cached once per config under its own key, so interactive TTV output keeps its linear semantics.
    // Skipped entirely when an explicit tRef wins.
    explicitTRef
      ? undefined
      : cachedTransitReferenceEpochSec(
          config,
          `tdv:${planetReferenceEpochKey(config, snap, starRef, planet)}`,
          () =>
            computeTransitReferenceEpochSec({
              rStar: starRef.r,
              rBody: planet.r,
              periodSec: planetPeriodSec(config, snap, planet),
              t0Sec: planetT0Sec(config, snap, planet),
              sampleAt: referenceSampleAt,
            }),
        ),
  );
  if (tRef === undefined) return undefined;
  const pRelRef = orbitStateAt(planetReferenceOrbit(config, snap, planet), tRef);
  const projected = projectToSky(pRelRef.v, snap.observerDir);
  return Math.hypot(projected.x, projected.y);
}

type TransitImpacts = { bPlanet?: number; bMoon?: number };

const transitImpactCache = new WeakMap<EducationScenarioV4, Map<string, TransitImpacts>>();

// The transit impact parameter is the minimum front-of-star sky separation over one
// crossing divided by R*, taken from the reference epoch so it does not depend on playback time.
function planetClosestApproach(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  planet: NativeBodyState,
): ClosestApproach | undefined {
  const periodSec = planetPeriodSec(config, snap, planet);
  const t0Sec = planetT0Sec(config, snap, planet) ?? 0;
  if (!(Number.isFinite(periodSec) && (periodSec as number) > 0 && Number.isFinite(t0Sec))) return undefined;
  const sampleAt = bodySampleAt(config, snap.observerDir, planetBody);
  const halfSec = (periodSec as number) / 2;
  const knots = eccentricTimeKnots(planetReferenceOrbit(config, snap, planet).e, halfSec * 2, t0Sec);
  return closestFrontApproach(sampleAt, t0Sec - halfSec, t0Sec + halfSec, 96, knots);
}

function moonClosestApproach(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
  planetApproach: ClosestApproach,
): ClosestApproach | undefined {
  const planetSample = bodySampleAt(config, snap.observerDir, planetBody)(planetApproach.tSec);
  const vSky = planetSample ? Math.hypot(planetSample.vSky.x, planetSample.vSky.y) : 0;
  const moonA = snap.moons[0] ? (sourceOrbit(snap.moons[0])?.a ?? 0) : 0;
  const periodSec = planetPeriodSec(config, snap, planet) ?? Number.POSITIVE_INFINITY;
  if (!(vSky > 0)) return undefined;
  const halfSec = Math.min(periodSec / 2, (2 * (starRef.r + planet.r + 2 * moonA)) / vSky);
  const sampleAt = bodySampleAt(config, snap.observerDir, (trialSnap) => trialSnap.moons[0]);
  return closestFrontApproach(sampleAt, planetApproach.tSec - halfSec, planetApproach.tSec + halfSec, 192);
}

function computeTransitImpacts(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
): TransitImpacts {
  const planetApproach = planetClosestApproach(config, snap, planet);
  if (!planetApproach || !(starRef.r > 0)) return {};
  const moonApproach = snap.moons[0]
    ? moonClosestApproach(config, snap, starRef, planet, planetApproach)
    : undefined;
  return {
    bPlanet: planetApproach.separation / starRef.r,
    bMoon: moonApproach ? moonApproach.separation / starRef.r : undefined,
  };
}

function cachedTransitImpacts(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  starRef: NativeBodyState,
  planet: NativeBodyState,
): TransitImpacts {
  const moon = snap.moons[0];
  const key = moon
    ? moonReferenceEpochKey(config, snap, starRef, moon, planet)
    : planetReferenceEpochKey(config, snap, starRef, planet);
  let cache = transitImpactCache.get(config);
  if (!cache) {
    cache = new Map<string, TransitImpacts>();
    transitImpactCache.set(config, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const impacts = computeTransitImpacts(config, snap, starRef, planet);
  cache.set(key, impacts);
  return impacts;
}

function observablesForSnapshot(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
  timing: StepTimingDiagnostics | undefined,
): StepObservables {
  const starRef = snap.stars[0];
  const moon = snap.moons[0];
  const obs = snap.observerDir;
  return {
    rvStar: radialVelocity(starRef.vAbs, obs),
    rvPlanet: radialVelocity(planetBody(snap).vAbs, obs),
    rvMoon: moon ? radialVelocity(moon.vAbs, obs) : undefined,
    rvStarRossiterMcLaughlin: rossiterMcLaughlinForSnapshot(config, snap, tObsSec),
    astrometricOffsetStar: { x: starRef.sky.x, y: starRef.sky.y },
    timing,
  };
}

export function computeTimingAndObservables(
  config: EducationScenarioV4,
  snap: NativeSnapshot,
  tObsSec: number,
): TimingAndObservables {
  const starRef = snap.stars[0];
  const planet = planetBody(snap);
  const moon = snap.moons[0];
  const obs = snap.observerDir;
  const planetSampleAt = exactSampleAt(config, obs, planetBody);
  const moonSampleAt = exactSampleAt(config, obs, (trialSnap) => trialSnap.moons[0]);
  // The TDV reference epoch is solved once per config (cached) with trial snapshots; TTV reference
  // epochs keep the per-mode sampler so interactive output stays linear.
  const planetReferenceSampleAt = bodySampleAt(config, obs, planetBody);
  const pEvent = estimatePlanetEvent(config, snap, starRef, planet, tObsSec, planetSampleAt);
  const mEvent = estimateMoonEvent(config, snap, starRef, planet, moon, tObsSec, moonSampleAt);
  const timing = timingDiagnostics(pEvent, mEvent);
  const planetVSky = skyVelocity(planet, starRef, obs);
  const vPlanetSky = Math.hypot(planetVSky.x, planetVSky.y);
  const vPlanetSkyRef = planetReferenceSkyVelocity(config, snap, starRef, planet, planetReferenceSampleAt);
  const tdvRatioRaw =
    vPlanetSkyRef !== undefined ? tdvRatioFromSkyPlaneSpeeds(vPlanetSkyRef, vPlanetSky) : Number.NaN;
  const tdvRatio = Number.isFinite(tdvRatioRaw) ? tdvRatioRaw : undefined;
  const relPlanetSky = relativeSky(planet, starRef);
  const relMoonSky = moon ? relativeSky(moon, starRef) : undefined;
  const impacts = cachedTransitImpacts(config, snap, starRef, planet);

  return {
    timing,
    observables: observablesForSnapshot(config, snap, tObsSec, timing),
    eventTimingConvergence: eventTimingConvergence(pEvent, mEvent),
    bPlanet: impacts.bPlanet,
    bMoon: impacts.bMoon,
    relPlanetSky,
    relMoonSky,
    vPlanetSky,
    vPlanetSkyRef,
    tdvRatio,
    conjunctionActive: conjunctionActiveForSnapshot(snap),
  };
}
