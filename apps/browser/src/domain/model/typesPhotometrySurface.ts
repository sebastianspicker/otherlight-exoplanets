/**
 * Defines stellar surface, brightness patch, and variability parameters.
 */
type BrightnessPatchShape = "circle" | "ellipse";

export type BrightnessPatch = {
  shape: BrightnessPatchShape;
  x: number;
  y: number;
  factor: number;
  r?: number;
  rx?: number;
  ry?: number;
  angle?: number;
  surface?: {
    lat: number;
    lon: number;
    angularRadius: number;
  };
};

type StellarVariabilityPhaseModel = "linear-period" | "true-anomaly";

export type StellarVariabilityParams = {
  enabled?: boolean;
  beamingAmp?: number;
  ellipsoidalAmp?: number;
  beamingOffset?: number;
  ellipsoidalOffset?: number;
  constant?: number;
  flare?: {
    enabled?: boolean;
    tPeakSec?: number;
    amp?: number;
    riseSec?: number;
    decaySec?: number;
  };
  pulsations?: {
    enabled?: boolean;
    modes?: Array<{
      amp?: number;
      periodSec?: number;
      phaseRad?: number;
    }>;
  };
  phaseModel?: StellarVariabilityPhaseModel;
  /** Opt-in: scale beaming and ellipsoidal terms from the companion state instead of the amp knobs. */
  physicalAmplitudes?: boolean;
  beamingAlpha?: number;
  ellipsoidalAlpha?: number;
  clampMin?: number;
  clampMax?: number;
};

export type SpotEvolutionParams = {
  enabled?: boolean;
  rotationPeriodSec?: number;
  rotationPhase0?: number;
  driftRateRadPerSec?: number;
  lifetimeSec?: number;
  coverage?: number;
  tRef?: number;
};

export type StellarSurfaceParams = {
  enabled?: boolean;
  useSurfacePatches?: boolean;
  rotationPeriodSec?: number;
  differentialRotationK?: number;
  granulationSigma?: number;
  granulationTimescaleSec?: number;
  activityCyclePeriodSec?: number;
  activityCycleAmp?: number;
};
