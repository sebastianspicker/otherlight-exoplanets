/**
 * Derives the initial runtime mode and display-flux settings from bootstrap state.
 */
import type { RuntimeModeV4 } from "../../domain/simulation/v4";
import { detachedBinaryBaselineFlux } from "../../domain/simulation/v4/binaryBaseline";
import { fluxDisplayTitle } from "./displayFlux";
import type { AppSimulationRuntime } from "./v4Runtime";

export const readBootstrapRuntimeMode = (value: string | undefined): RuntimeModeV4 =>
  value === "reference" ? "reference" : "realtime";

export const syncBootstrapDisplayFlux = (
  state: { displayFluxScale: number; displayFluxTitle: string },
  simulation: AppSimulationRuntime,
): void => {
  const config = simulation.getConfig();
  state.displayFluxScale = detachedBinaryBaselineFlux(config) ?? 1;
  state.displayFluxTitle = fluxDisplayTitle(config);
};
