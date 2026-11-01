/** Normalizes and reads scalar form inputs for the UI parameter layer. */
//
// UI input helpers + sanitizers.

import { clamp, toFiniteNumber, ECC_MAX } from "../../domain/model/units";
import { markLoadedNumericValue } from "./scenarioControlRanges";

type PlotMode = "physical" | "measured";
type PlotTrackingMode = "fixed" | "dynamic" | "live";

export function readPlotMode(el: HTMLSelectElement | HTMLInputElement | null): PlotMode {
  if (!el) return "physical";
  return el.value === "measured" ? "measured" : "physical";
}

export function readPlotTrackingMode(el: HTMLSelectElement | HTMLInputElement | null): PlotTrackingMode {
  if (!el) return "fixed";
  return el.value === "live" ? "live" : el.value === "dynamic" ? "dynamic" : "fixed";
}

export function readClampSmearedFlux(el: HTMLInputElement | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement && el.type === "checkbox") return Boolean(el.checked);
  return false;
}

export function readNumberInput(el: HTMLInputElement, fallback: number): number {
  const n = Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : toFiniteNumber(el.value, NaN);
  return Number.isFinite(n) ? n : fallback;
}

/** Writes a loaded scenario value exactly; range checks accept it even outside normal bounds. */
export function writeNumberInput(el: HTMLInputElement, value: number): void {
  el.value = Number.isFinite(value) ? String(value) : "";
  markLoadedNumericValue(el, value);
}

export function readCheckbox(el: HTMLInputElement): boolean {
  return Boolean(el.checked);
}

export function readSelect(el: HTMLSelectElement, fallback: string): string {
  const v = el.value;
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

type Limits = readonly [min: number, max: number];
export const ORBIT_A_LIMITS: Limits = [0.001, 1e12];
export const ORBIT_PERIOD_LIMITS: Limits = [0.001, 1e18];
const INC_DEG_LIMITS: Limits = [0, 180];
export const RING_INC_DEG_LIMITS: Limits = [0, 90];
export const RADIUS_LIMITS: Limits = [1e3, 1e12];
export const MASS_LIMITS: Limits = [0, 1e30];
export const RING_RADIUS_LIMITS: Limits = [0, 1e12];

export const HARD_INPUT_LIMITS = {
  planetA: ORBIT_A_LIMITS,
  moonA: ORBIT_A_LIMITS,
  planetPeriod: ORBIT_PERIOD_LIMITS,
  moonPeriod: ORBIT_PERIOD_LIMITS,
  planetInc: INC_DEG_LIMITS,
  moonInc: INC_DEG_LIMITS,
  starR: RADIUS_LIMITS,
  planetR: RADIUS_LIMITS,
  moonR: RADIUS_LIMITS,
  planetMass: MASS_LIMITS,
  moonMass: MASS_LIMITS,
  planetRingInner: RING_RADIUS_LIMITS,
  planetRingOuter: RING_RADIUS_LIMITS,
  moonRingInner: RING_RADIUS_LIMITS,
  moonRingOuter: RING_RADIUS_LIMITS,
  planetRingInc: RING_INC_DEG_LIMITS,
  moonRingInc: RING_INC_DEG_LIMITS,
  p1r: [0, 1e12],
  p1f: [0, 1e6],
  p2rx: [0, 1e12],
  p2ry: [0, 1e12],
  p2f: [0, 1e6],
  baselineFlux: [0, 1e9],
  spotLifetime: [0, 1e12],
  spotRotationPeriod: [1, 1e12],
  planetReflAmp: [0, 10],
  planetThermAmp: [0, 10],
  planetConstant: [0, 10],
  moonReflAmp: [0, 10],
  moonThermAmp: [0, 10],
  varConstant: [0, 10],
  fsAmp: [0, 10],
  fsSigma: [1e-6, 10],
  atmR0: [0, 1e9],
  atmH: [0, 1e9],
  atmTau0: [0, 1e12],
  planetThermalTimescale: [0, 1e12],
  moonThermalTimescale: [0, 1e12],
  cadenceSec: [0, 1e9],
  exoVelDt: [1e-6, 1e9],
} as const satisfies Record<string, Limits>;

/**
 * Hard model limits per input element id. Readers clamp to these; override mode
 * validation reports them instead of letting the reader clamp silently.
 */
export function hardInputLimits(id: string): Limits | undefined {
  return (HARD_INPUT_LIMITS as Record<string, Limits>)[id];
}

export function sanitizeIncDeg(vDeg: number): number {
  return clamp(vDeg, ...INC_DEG_LIMITS);
}

// Numerical stability policy (elliptic only)
export function sanitizeEcc(v: number): number {
  return clamp(v, 0, ECC_MAX);
}

/**
 * Clamps `v` into [lo, hi]. The name is misleading: it does not enforce positivity,
 * it is effectively `clamp(v, lo, hi)`. Callers frequently pass `lo = 0`.
 * Kept as-is to avoid a large rename across ~40 call sites.
 */
export function sanitizePositive(v: number, lo: number, hi: number): number {
  return clamp(v, lo, hi);
}

export function sanitizeFinite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
