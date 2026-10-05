/**
 * Computes phase angles and the reflected and thermal model weights.
 */
import type { DayNightVisibilityParams } from "../model/types";
import type { Vec3 } from "../orbits/vec3";
import { vIsFinite, vLen } from "../orbits/vec3";
import type { ReflectedPhaseModel, ThermalPhaseModel } from "./dayNightVisibility";
import { applyPhaseOffset, phaseAngleRadFromBodyPos, shiftedPhaseAngleRad } from "./dayNightVisibility";
import type { BodyPhaseFluxParams, NormalizedPhaseCurveModel } from "./phaseCurveTypes";

/** Unshifted phase angle plus the state needed to rotate the body along its orbit. */
export type BodyPhaseGeometry = {
  alpha: number;
  rBody: Vec3;
  vBody?: Vec3;
  observerDir: Vec3;
};

function bodyPhaseAlpha(params: BodyPhaseFluxParams): number | undefined {
  if (!vIsFinite(params.rBody) || !vIsFinite(params.observerDir)) return undefined;
  if (vLen(params.rBody) < 1e-15) return undefined;
  const alpha = phaseAngleRadFromBodyPos(params.rBody, params.observerDir);
  return Number.isFinite(alpha) ? alpha : undefined;
}

export function bodyPhaseGeometry(params: BodyPhaseFluxParams): BodyPhaseGeometry | undefined {
  const alpha = bodyPhaseAlpha(params);
  if (alpha === undefined) return undefined;
  return { alpha, rBody: params.rBody, vBody: params.vBody, observerDir: params.observerDir };
}

/**
 * Effective phase angle for a signed orbital shift (hotspot offset or thermal lag): the body is
 * rotated by -shiftRad along its orbit when its velocity is known, so the peak moves before or after
 * superior conjunction. Without a velocity it falls back to the legacy shift-and-clamp of alpha.
 */
export function phaseAlphaWithShift(geometry: BodyPhaseGeometry, shiftRad: number): number {
  if (shiftRad === 0 || !geometry.vBody) return applyPhaseOffset(geometry.alpha, -shiftRad);
  const shifted = shiftedPhaseAngleRad(geometry.rBody, geometry.vBody, geometry.observerDir, shiftRad);
  return shifted ?? applyPhaseOffset(geometry.alpha, -shiftRad);
}

export function reflectedModelFor(
  norm: NormalizedPhaseCurveModel,
  dn: DayNightVisibilityParams | undefined,
): ReflectedPhaseModel {
  if (dn?.enabled) return (dn.reflectedModel ?? "lambert") as ReflectedPhaseModel;
  return (norm.reflModel ?? (norm.lambertian ? "lambert" : "cosine")) as ReflectedPhaseModel;
}

export function thermalModelFor(
  norm: NormalizedPhaseCurveModel,
  dn: DayNightVisibilityParams | undefined,
): ThermalPhaseModel {
  if (dn?.enabled) return (dn.thermalModel ?? "constant") as ThermalPhaseModel;
  return (norm.thermalModel ?? "cosine") as ThermalPhaseModel;
}

export function clampWeightsFor(
  norm: NormalizedPhaseCurveModel,
  dn: DayNightVisibilityParams | undefined,
): boolean {
  return dn?.enabled ? dn.clamp !== false : norm.clamp;
}
