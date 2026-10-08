/** Defines common event samples, estimates and convergence diagnostics. */
import type { SkyPoint, StepEventTimingSolveDiagnostics } from "../model/types";
import type { TransitEventSampler } from "./transitContactIsolation";

export type TransitEventEstimate = {
  centerSec: number;
  durationSec: number;
  ingressSec: number;
  egressSec: number;
  ttvSec?: number;
};

export type TransitEventSolveResult = {
  event?: TransitEventEstimate;
  diagnostics: StepEventTimingSolveDiagnostics;
};

export type TransitEventSample = {
  sky: SkyPoint;
  vSky: SkyPoint;
};

export type ExactTransitSolveArgs = {
  linear: TransitEventEstimate;
  tObsSec: number;
  rStar: number;
  rBody: number;
  sampleAt: TransitEventSampler;
  periodSec?: number;
  transitReferenceEpochSec?: number;
};
