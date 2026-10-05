/**
 * Defines the stellar-surface edge-case presets.
 */
import type { BrowserScenarioDraft, LimbDarkeningModel } from "../../domain/model/types";
import { G_SI } from "../../domain/model/units";
import {
  enableAccuratePhysics,
  ensureMoon,
  makeEdgeCasePreset,
  setPlanetImpactParameter,
  stripToTransitCase,
} from "./presetEdgeCaseUtils";
import { ADVANCED_ATMOSPHERE_EDGE_CASE_PRESETS } from "./presetsAtmosphereAdvanced";

// Exomoon edge cases widen the planet orbit 4x (P = 5.9 d) so the Hill radius
// a_p (m_p / 3 M*)^(1/3) = 1.7e9 m holds moons at a = 4e8-6.2e8 m (< 0.4 r_H).
const EXOMOON_PLANET_ORBIT_SCALE = 4;

function keplerPeriodSec(a: number, totalMassKg: number): number {
  return 2 * Math.PI * Math.sqrt(a ** 3 / (G_SI * totalMassKg));
}

function widenPlanetOrbitForMoon(p: BrowserScenarioDraft): void {
  const orbit = p.planet.orbit;
  if (!("a" in orbit) || !("period" in orbit)) return;
  orbit.a *= EXOMOON_PLANET_ORBIT_SCALE;
  orbit.period = keplerPeriodSec(orbit.a, (p.star.m ?? 0) + (p.planet.m ?? 0));
}

/** Sets a face-on moon orbit with a Kepler-consistent period and phase (fraction of the moon period). */
function setMoonOrbit(p: BrowserScenarioDraft, a: number, phase: number): void {
  const moon = ensureMoon(p);
  const orbit = moon.orbitAroundPlanet;
  if (!("a" in orbit) || !("period" in orbit)) return;
  orbit.a = a;
  orbit.inc = 0;
  orbit.period = keplerPeriodSec(a, (p.planet.m ?? 0) + (moon.m ?? 0));
  orbit.t0 = phase * orbit.period;
}

export const SURFACE_EDGE_CASE_PRESETS = [
  makeEdgeCasePreset(
    "ec-geometry-central-transit",
    "Edge Case: central transit",
    "Planet-only central transit baseline with a near-zero impact parameter and no additive or measurement-layer clutter.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0);
    },
  ),
  makeEdgeCasePreset(
    "ec-geometry-grazing-transit",
    "Edge Case: grazing transit",
    "Planet-only grazing transit where the chord barely crosses the stellar disk and the morphology becomes visibly V-shaped.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.95);
    },
  ),
  makeEdgeCasePreset(
    "ec-geometry-near-miss",
    "Edge Case: near miss",
    "Planet-only geometry with no front-of-star transit, useful for teaching that nearby orbital configurations still may not produce an event.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 1.35);
    },
  ),
  makeEdgeCasePreset(
    "ec-geometry-long-cadence-smear",
    "Edge Case: long-cadence smear",
    "Central transit viewed with long cadence and no subsample refinement so ingress and egress are visibly rounded away.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.04);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.cadenceSec = 1800;
      ph.nSubsamples = 1;
    },
  ),
  makeEdgeCasePreset(
    "ec-exomoon-separated",
    "Edge Case: separated exomoon dip",
    "Planet and moon both transit, but the moon is spaced far enough from the planet to produce its own readable feature.",
    (p) => {
      stripToTransitCase(p, { keepMoon: true });
      widenPlanetOrbitForMoon(p);
      setPlanetImpactParameter(p, 0.08);
      ensureMoon(p).r = 6e7;
      // P_moon = 63 460 s; the moon leads the planet by ~5 600 s at its own mid-transit.
      setMoonOrbit(p, 6.2e8, 0.375);
    },
  ),
  makeEdgeCasePreset(
    "ec-exomoon-overlap",
    "Edge Case: overlapping exomoon dip",
    "Planet and moon both transit, but the moon remains so close in timing that the signal is buried inside the main dip.",
    (p) => {
      stripToTransitCase(p, { keepMoon: true });
      widenPlanetOrbitForMoon(p);
      setPlanetImpactParameter(p, 0.08);
      ensureMoon(p).r = 6e7;
      // a = 2.7 R_p, P_moon = 32 885 s; the moon transits within ~100 s of the planet centre.
      setMoonOrbit(p, 4e8, 0.625);
    },
  ),
  makeEdgeCasePreset(
    "ec-exomoon-moon-only",
    "Edge Case: moon-only transit",
    "The planet misses the stellar disk while the moon still crosses, demonstrating that moon existence and planet transit are separate geometric questions.",
    (p) => {
      stripToTransitCase(p, { keepMoon: true });
      widenPlanetOrbitForMoon(p);
      setPlanetImpactParameter(p, 1.35);
      ensureMoon(p).r = 6.5e7;
      // b_planet = 1.35 > 1 + R_p/R* misses; the moon (P = 45 958 s) crosses at b_moon = 0.64.
      setMoonOrbit(p, 5e8, 0);
    },
  ),
  makeEdgeCasePreset(
    "ec-geometry-oblate-planet",
    "Edge Case: oblate planet",
    "Central transit of an oblate planet so the learner can compare a flattened silhouette against the spherical baseline.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.15);
      p.planet.shape = { oblateness: 0.22, angle: 0.55 };
      enableAccuratePhysics(p, { nonSphericalFlux: true });
    },
  ),
  makeEdgeCasePreset(
    "ec-geometry-ringed-planet",
    "Edge Case: ringed planet",
    "Central transit of a ringed planet with bounded ring scattering enabled for a visibly broadened, didactic morphology.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.12);
      p.planet.rings = {
        innerRadius: p.planet.r * 1.3,
        outerRadius: p.planet.r * 2.2,
        inclination: 0.65,
        positionAngle: 0.3,
        opacity: 0.6,
      };
      const ph = p.star.photometry;
      if (!ph) return;
      ph.ringScattering = { enabled: true, amp: 0.0015, sigmaPhase: 0.18 };
      ph.additiveComposition = "higher-fidelity-coupled";
      enableAccuratePhysics(p, { nonSphericalFlux: true });
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-limb-darkening-strong",
    "Edge Case: strong limb darkening",
    "Planet-only transit with exaggerated quadratic limb darkening to make ingress and egress curvature easy to compare.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.05);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.limbDarkeningModel = {
        bandpass: "g",
        default: { kind: "quadratic", u1: 0.7, u2: 0.18 },
        bands: {
          g: { kind: "quadratic", u1: 0.7, u2: 0.18 },
          r: { kind: "quadratic", u1: 0.5, u2: 0.26 },
        },
      } satisfies LimbDarkeningModel;
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-spot-crossing",
    "Edge Case: spot crossing",
    "A dark stellar patch lies directly on the transit chord, producing an in-transit anomaly when the planet crosses it.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.02);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.brightnessPatches = [{ shape: "circle", x: 0, y: 0, r: 0.18 * p.star.r, factor: 0.65 }];
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-facula-crossing",
    "Edge Case: facula crossing",
    "A bright stellar patch lies directly on the transit chord, demonstrating that local stellar brightening can invert the sign of an anomaly.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.02);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.brightnessPatches = [{ shape: "circle", x: 0, y: 0, r: 0.18 * p.star.r, factor: 1.18 }];
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-unocculted-spots",
    "Edge Case: unocculted spots",
    "A dark patch sits away from the transit chord, biasing the apparent depth without being crossed by the planet.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.02);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.brightnessPatches = [
        { shape: "circle", x: -0.45 * p.star.r, y: 0.5 * p.star.r, r: 0.18 * p.star.r, factor: 0.68 },
      ];
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-unocculted-faculae",
    "Edge Case: unocculted faculae",
    "A bright patch sits away from the transit chord, making the same planet transit look shallower by changing the stellar baseline.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.02);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.brightnessPatches = [
        { shape: "circle", x: 0.42 * p.star.r, y: 0.48 * p.star.r, r: 0.18 * p.star.r, factor: 1.22 },
      ];
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-spot-evolution",
    "Edge Case: spot evolution",
    "Transit chord with evolving stellar patches so repeated epochs can change without changing the planet itself.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.03);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.brightnessPatches = [
        { shape: "circle", x: 0.15 * p.star.r, y: -0.08 * p.star.r, r: 0.16 * p.star.r, factor: 0.72 },
      ];
      ph.spotEvolution = {
        enabled: true,
        rotationPeriodSec: 180_000,
        rotationPhase0: 0,
        driftRateRadPerSec: 2e-6,
        lifetimeSec: 800_000,
        coverage: 1,
        tRef: 0,
      };
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-flare-transient",
    "Edge Case: stellar flare transient",
    "Transit observed during a bounded stellar flare, useful for teaching that short-lived stellar brightening can partially fill a transit.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.08);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.stellarVariability = {
        enabled: true,
        flare: { enabled: true, tPeakSec: 0, amp: 0.008, riseSec: 1200, decaySec: 5400 },
      };
    },
  ),
  makeEdgeCasePreset(
    "ec-stellar-pulsation-contamination",
    "Edge Case: stellar pulsation contamination",
    "Transit with deterministic multi-mode stellar pulsations so periodic baseline structure can be compared against true transit-shape changes.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.08);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.stellarVariability = {
        enabled: true,
        pulsations: {
          enabled: true,
          modes: [
            { amp: 0.0014, periodSec: 3.5 * 3600, phaseRad: 0.2 },
            { amp: 0.0007, periodSec: 1.2 * 3600, phaseRad: 1.1 },
          ],
        },
      };
    },
  ),
  makeEdgeCasePreset(
    "ec-atmosphere-transmissive-halo",
    "Edge Case: transmissive atmosphere",
    "Planet transit with a bounded exponential atmospheric halo so the body is no longer a purely opaque occulter.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.08);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.atmosphereTransmission = {
        enabled: true,
        target: "planet",
        kind: "exponential-halo",
        r0: p.planet.r,
        H: 1.2e7,
        tau0: 0.9,
      };
    },
  ),
  makeEdgeCasePreset(
    "ec-atmosphere-extended-exosphere",
    "Edge Case: extended exosphere",
    "Planet transit with a larger, lower-opacity halo to demonstrate an extended atmosphere or exosphere.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.08);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.atmosphereTransmission = {
        enabled: true,
        target: "planet",
        kind: "exponential-halo",
        r0: p.planet.r,
        H: 3.5e7,
        tau0: 0.45,
      };
    },
  ),
  makeEdgeCasePreset(
    "ec-atmosphere-chromatic-transmission",
    "Edge Case: chromatic transmission",
    "Atmospheric transmission with a simple wavelength grid so apparent transit depth varies by passband.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.08);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.atmosphereTransmission = {
        enabled: true,
        target: "planet",
        kind: "exponential-halo",
        r0: p.planet.r,
        H: 1.6e7,
        tau0: 0.8,
        lambdaNm: [450, 550, 800],
        tauScale: [1.25, 1, 0.72],
      };
    },
  ),
  ...ADVANCED_ATMOSPHERE_EDGE_CASE_PRESETS,
  makeEdgeCasePreset(
    "ec-atmosphere-forward-scattering",
    "Edge Case: forward scattering",
    "Planet transit with a forward-scattering brightening term so the learner sees a pre/post-transit excess instead of only dimming.",
    (p) => {
      stripToTransitCase(p);
      setPlanetImpactParameter(p, 0.12);
      const ph = p.star.photometry;
      if (!ph) return;
      ph.forwardScattering = {
        enabled: true,
        amp: 0.0025,
        g: 0.92,
        sigmaPhase: 0.08,
        phaseOffset: 0,
        gateWhenBehindStar: true,
        clampNonNegative: true,
      };
      ph.additiveComposition = "higher-fidelity-coupled";
    },
  ),
];
