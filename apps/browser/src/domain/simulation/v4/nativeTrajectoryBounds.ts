/** Conservative relative speed bounds for sums of authored Kepler orbits and orientation drifts. */
import type { Vec3 } from "../../orbits/vec3";
import { vSub } from "../../orbits/vec3";
import { projectToSky } from "../../orbits/frames";
import type { TransitEventSampler } from "../transitContactIsolation";
import { buildNativeSnapshot, type NativeSnapshot, type NativeBodyState } from "./nativeSnapshot";
import type { EducationScenarioV4 } from "./types";

function trajectorySpeedBound(config: EducationScenarioV4): number {
  const orbits = [
    config.orbits.binary,
    ...config.bodies.planets.map((p) => p.orbit),
    ...config.bodies.moons.map((m) => m.orbit),
  ];
  const speed = orbits.reduce(
    (sum, orbit) => sum + ((2 * Math.PI * orbit.a) / orbit.period) * Math.sqrt((1 + orbit.e) / (1 - orbit.e)),
    0,
  );
  const drift = config.dynamics?.exomoonTimingShape;
  const rate = drift?.enabled
    ? Math.abs(drift.moonOmegaDot ?? 0) +
      Math.abs(drift.moonIncDot ?? 0) +
      Math.abs(drift.moonOmegaSmallDot ?? 0)
    : 0;
  const drifting = config.bodies.moons.reduce(
    (sum, moon) => sum + moon.orbit.a * (1 + moon.orbit.e) * rate,
    0,
  );
  // Every barycentric coefficient is in [-1,1]; subtracting two bodies adds at most two copies.
  return 2 * (speed + drifting) * (1 + 32 * Number.EPSILON);
}

/** Adds periapsis-resolving time knots for front-side minimum searches. */
export function eccentricTimeKnots(e: number, period: number, epoch: number): number[] {
  return Array.from({ length: 193 }, (_, index) => {
    const anomaly = -Math.PI + (index * Math.PI) / 96;
    return epoch + ((anomaly - e * Math.sin(anomaly)) * period) / (2 * Math.PI);
  });
}

/** Supplies relative projected states together with their global speed bound. */
export function bodySampleAt(
  config: EducationScenarioV4,
  obs: Vec3,
  selectBody: (snapshot: NativeSnapshot) => NativeBodyState | undefined,
): TransitEventSampler {
  const sample: TransitEventSampler = (time) => {
    const snapshot = buildNativeSnapshot(config, time);
    const star = snapshot.stars[0];
    const body = selectBody(snapshot);
    if (!star || !body) return undefined;
    return {
      sky: projectToSky(vSub(body.rAbs, star.rAbs), obs),
      vSky: projectToSky(vSub(body.vAbs, star.vAbs), obs),
    };
  };
  sample.speedBound = trajectorySpeedBound(config);
  return sample;
}
