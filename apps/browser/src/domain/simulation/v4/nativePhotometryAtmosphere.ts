/** Builds native V4 photometric occulters with atmospheric transmission. */
import { clamp01 } from "../../model/units";
import {
  effectiveCircleAtmosphereOpacity,
  totalAtmosphereTransmission,
} from "../../photometry/atmosphereRT/model";
import { resolveWeightedPhotometryBands } from "./nativePhotometryBands";
import { isUsableAtmosphereLayer } from "./atmosphereSelection";
import type { PhotometricBody, VisibilityOcculter, WeightedPhotometryBand } from "./nativePhotometryTypes";
import type { EducationScenarioV4 } from "./types";

const SHELL_OUTER_BUFFER_FACTOR = 1.000001;

export function atmosphereOpacityForOcculter(
  config: EducationScenarioV4,
  body: { kind: "star" | "planet" | "moon"; r: number },
): number {
  const target = atmosphereTargetForBody(body.kind);
  if (!target) return 1;
  const bands = resolveWeightedPhotometryBands(config);
  const rtOpacity = atmosphereRtOpacityForTarget(config, body.r, target, bands);
  return rtOpacity ?? legacyAtmosphereOpacityForTarget(config, body.r, target, bands);
}

export function photometricOcculterForBody(
  config: EducationScenarioV4,
  body: PhotometricBody,
): VisibilityOcculter {
  const target = atmosphereTargetForBody(body.kind);
  if (!target) return { r: body.r, sky: body.sky, opacity: 1 };
  const bands = resolveWeightedPhotometryBands(config);
  return (
    rtPhotometricOcculter(config, body, target, bands) ??
    legacyPhotometricOcculter(config, body, target, bands) ?? { r: body.r, sky: body.sky, opacity: 1 }
  );
}

const atmosphereTargetForBody = (kind: "star" | "planet" | "moon"): "planet" | "moon" | undefined =>
  kind === "moon" ? "moon" : kind === "planet" ? "planet" : undefined;

const atmosphereRtOpacityForTarget = (
  config: EducationScenarioV4,
  bodyRadius: number,
  target: "planet" | "moon",
  bands: WeightedPhotometryBand[],
): number | undefined => {
  const rt = config.photometry?.atmosphereRT;
  if (
    !(rt?.enabled && Array.isArray(rt.layers) && rt.layers.length > 0 && (rt.target ?? "planet") === target)
  )
    return undefined;
  const layers = rt.layers.filter(isUsableAtmosphereLayer);
  if (layers.length === 0) return undefined;
  let weightedOpacity = 0;
  for (const band of bands) {
    weightedOpacity +=
      band.weight *
      effectiveCircleAtmosphereOpacity({
        bodyRadius,
        lambdaNm: band.lambdaNm,
        config: { ...rt, layers },
      });
  }
  return clamp01(weightedOpacity);
};

const legacyAtmosphereOpacityForTarget = (
  config: EducationScenarioV4,
  bodyRadius: number,
  target: "planet" | "moon",
  bands: WeightedPhotometryBand[],
): number => {
  const transmission = config.photometry?.atmosphereTransmission;
  if (!transmission?.enabled || (transmission.target ?? "planet") !== target) return 1;
  let weightedOpacity = 0;
  for (const band of bands) {
    weightedOpacity +=
      band.weight *
      effectiveLegacyTransmissionOpacity({ bodyRadius, config: transmission, tauScale: band.legacyTauScale });
  }
  return clamp01(weightedOpacity);
};

const rtPhotometricOcculter = (
  config: EducationScenarioV4,
  body: PhotometricBody,
  target: "planet" | "moon",
  bands: WeightedPhotometryBand[],
): VisibilityOcculter | undefined => {
  const rt = config.photometry?.atmosphereRT;
  if (
    !(rt?.enabled && (rt.target ?? "planet") === target && Array.isArray(rt.layers) && rt.layers.length > 0)
  )
    return undefined;
  const validLayers = rt.layers.filter(isUsableAtmosphereLayer);
  if (validLayers.length === 0) return undefined;
  const opaqueRadius = Math.max(body.r, ...validLayers.map((layer) => layer.r0));
  const outer = Math.max(opaqueRadius, ...validLayers.map((layer) => layer.r0 + 6 * layer.H));
  const profile = { ...rt, layers: validLayers };
  const transmissionByBand = bands.map((band) => ({
    lambdaNm: band.lambdaNm,
    weight: band.weight,
    transmissionAtRadius: sampledAtmosphereTransmission(opaqueRadius, outer, (rho) =>
      totalAtmosphereTransmission({ rho, config: profile, lambdaNm: band.lambdaNm }),
    ),
  }));
  return {
    r: outer,
    sky: body.sky,
    transmissionByBand,
    transmissionAtRadius: weightedTransmission(transmissionByBand),
  };
};

const legacyPhotometricOcculter = (
  config: EducationScenarioV4,
  body: PhotometricBody,
  target: "planet" | "moon",
  bands: WeightedPhotometryBand[],
): VisibilityOcculter | undefined => {
  const legacy = config.photometry?.atmosphereTransmission;
  if (!(legacy?.enabled && (legacy.target ?? "planet") === target)) return undefined;
  const r0 = isFinitePositive(legacy.r0) ? legacy.r0 : body.r;
  const H = isFinitePositive(legacy.H) ? legacy.H : 0;
  const opaqueRadius = Math.max(body.r, r0);
  const outer = Math.max(opaqueRadius, r0 + 6 * H);
  const transmissionByBand = bands.map((band) => ({
    lambdaNm: band.lambdaNm,
    weight: band.weight,
    transmissionAtRadius: sampledAtmosphereTransmission(opaqueRadius, outer, (rho) =>
      legacyTransmissionAtRadius({
        rho,
        bodyRadius: body.r,
        r0,
        H,
        tau0: legacy.tau0 ?? 0,
        tauScale: band.legacyTauScale,
        kind: legacy.kind,
      }),
    ),
  }));
  return {
    r: outer,
    sky: body.sky,
    transmissionByBand,
    transmissionAtRadius: weightedTransmission(transmissionByBand),
  };
};

const weightedTransmission =
  (
    bands: Array<{ weight: number; transmissionAtRadius: (rho: number) => number }>,
  ): ((rho: number) => number) =>
  (rho) =>
    bands.reduce((sum, band) => sum + band.weight * band.transmissionAtRadius(rho), 0);

const sampledAtmosphereTransmission = (
  opaqueRadius: number,
  outerRadius: number,
  evaluateShell: (rho: number) => number,
): ((rho: number) => number) => {
  const count = 256;
  const width = outerRadius - opaqueRadius;
  if (!(width > 0)) return (rho) => (rho <= opaqueRadius ? 0 : 1);
  // Use a representable point outside the core even for an extremely thin shell.
  const firstShellRadius = opaqueRadius + Math.max(Number.MIN_VALUE, opaqueRadius * Number.EPSILON);
  const values = Array.from({ length: count + 1 }, (_, index) =>
    clamp01(evaluateShell(Math.max(firstShellRadius, opaqueRadius + (width * index) / count))),
  );
  return (rho) => {
    if (rho <= opaqueRadius) return 0;
    if (rho >= outerRadius) return 1;
    const coordinate = ((rho - opaqueRadius) / width) * count;
    const lower = Math.floor(coordinate);
    const fraction = coordinate - lower;
    return values[lower] * (1 - fraction) + values[lower + 1] * fraction;
  };
};

const effectiveLegacyTransmissionOpacity = (args: {
  bodyRadius: number;
  config: NonNullable<EducationScenarioV4["photometry"]>["atmosphereTransmission"];
  tauScale: number;
}): number => {
  const transmission = args.config;
  if (!transmission?.enabled) return 1;
  const r0 = isFinitePositive(transmission.r0) ? transmission.r0 : args.bodyRadius;
  if (!(Number.isFinite(r0) && r0 > 0)) return 1;
  const H = isFinitePositive(transmission.H) ? transmission.H : 0;
  const inner = Math.max(args.bodyRadius, r0);
  const outer = Math.max(inner * SHELL_OUTER_BUFFER_FACTOR, inner + Math.max(args.bodyRadius * 0.25, H * 6));
  const averageTransmission = averageLegacyShellTransmission(args, { r0, H, inner, outer });
  return clamp01(1 - averageTransmission);
};

const averageLegacyShellTransmission = (
  args: {
    bodyRadius: number;
    config: NonNullable<EducationScenarioV4["photometry"]>["atmosphereTransmission"];
    tauScale: number;
  },
  shell: { r0: number; H: number; inner: number; outer: number },
): number => {
  const radialSamples = 24;
  let weightedTransmission = 0;
  let weightSum = 0;
  for (let i = 0; i < radialSamples; i++) {
    const t0 = i / radialSamples;
    const t1 = (i + 1) / radialSamples;
    const rhoLo = shell.inner + (shell.outer - shell.inner) * t0;
    const rhoHi = shell.inner + (shell.outer - shell.inner) * t1;
    const rhoMid = 0.5 * (rhoLo + rhoHi);
    const annulusWeight = Math.max(0, rhoHi * rhoHi - rhoLo * rhoLo);
    const pointTransmission = legacyTransmissionAtRadius({
      rho: rhoMid,
      bodyRadius: args.bodyRadius,
      r0: shell.r0,
      H: args.config?.H ?? 0,
      tau0: args.config?.tau0 ?? 0,
      tauScale: args.tauScale,
      kind: args.config?.kind,
    });
    weightedTransmission += pointTransmission * annulusWeight;
    weightSum += annulusWeight;
  }
  return weightSum > 0
    ? weightedTransmission / weightSum
    : legacyTransmissionAtRadius({
        rho: shell.inner * SHELL_OUTER_BUFFER_FACTOR,
        bodyRadius: args.bodyRadius,
        r0: shell.r0,
        H: args.config?.H ?? 0,
        tau0: args.config?.tau0 ?? 0,
        tauScale: args.tauScale,
        kind: args.config?.kind,
      });
};

const legacyTransmissionAtRadius = (args: {
  rho: number;
  bodyRadius: number;
  r0: number;
  H: number;
  tau0: number;
  tauScale: number;
  kind?: "hard" | "exponential-halo" | "custom";
}): number => {
  if (!(Number.isFinite(args.rho) && args.rho >= 0)) return 1;
  const r0 = isFinitePositive(args.r0) ? args.r0 : args.bodyRadius;
  if (!(Number.isFinite(r0) && r0 > 0)) return 1;
  const boundaryTransmission = legacyBoundaryTransmission(args, r0);
  if (boundaryTransmission !== undefined) return boundaryTransmission;
  const tau = legacyTransmissionTau(args, r0);
  return tau > 0 ? Math.exp(-Math.max(0, Math.min(60, tau))) : 1;
};

const legacyBoundaryTransmission = (
  args: { rho: number; kind?: "hard" | "exponential-halo" | "custom" },
  r0: number,
): number | undefined => {
  if (!(args.rho > r0)) return 0;
  if (args.kind === "hard") return 1;
  return undefined;
};

const legacyTransmissionTau = (
  args: { rho: number; H: number; tau0: number; tauScale: number },
  r0: number,
): number => {
  const H = isFinitePositive(args.H) ? args.H : 0;
  const tau0 = Number.isFinite(args.tau0) ? Math.max(0, args.tau0) : 0;
  const tauScale = Number.isFinite(args.tauScale) ? Math.max(0, args.tauScale) : 1;
  return H > 0 && tau0 > 0 ? tau0 * tauScale * Math.exp(-(args.rho - r0) / H) : 0;
};

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
