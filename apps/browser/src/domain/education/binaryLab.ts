/**
 * Holds the binary-lab hypothesis and reveal state machine.
 */
export type BinaryLabHypothesis =
  | "primary-eclipse-deepest"
  | "secondary-eclipse-dominates"
  | "eccentricity-shifts-eclipse-spacing";

export type BinaryLabState = {
  skyVisible: boolean;
  revealed: boolean;
  hypothesis?: BinaryLabHypothesis;
  hideSkyUntilReveal: boolean;
  requireHypothesis: boolean;
  lockParamsUntilHypothesis: boolean;
};

export type BinaryLabStateOptions = {
  hideSkyUntilReveal?: boolean;
  requireHypothesis?: boolean;
  lockParamsUntilHypothesis?: boolean;
};

export function createBinaryLabState(opts: BinaryLabStateOptions = {}): BinaryLabState {
  const hideSkyUntilReveal = Boolean(opts.hideSkyUntilReveal ?? true);
  const requireHypothesis = Boolean(opts.requireHypothesis ?? true);
  const lockParamsUntilHypothesis = Boolean(opts.lockParamsUntilHypothesis ?? true);

  return {
    skyVisible: !hideSkyUntilReveal,
    revealed: !hideSkyUntilReveal,
    hypothesis: undefined,
    hideSkyUntilReveal,
    requireHypothesis,
    lockParamsUntilHypothesis,
  };
}

/** True once a hidden sky has been revealed: the pre-reveal hypothesis can no longer change. */
export function isHypothesisLocked(state: BinaryLabState): boolean {
  return state.revealed && state.hideSkyUntilReveal;
}

/** Commits a pre-reveal hypothesis; once the sky is revealed the hypothesis is frozen. */
export function setHypothesis(state: BinaryLabState, hypothesis: BinaryLabHypothesis): BinaryLabState {
  if (isHypothesisLocked(state)) return state;
  return {
    ...state,
    hypothesis,
  };
}

export function canRevealSky(state: BinaryLabState): boolean {
  if (!state.hideSkyUntilReveal) return true;
  if (!state.requireHypothesis) return true;
  return Boolean(state.hypothesis);
}

export function canEditParams(state: BinaryLabState): boolean {
  if (!state.lockParamsUntilHypothesis) return true;
  return Boolean(state.hypothesis);
}

export function revealSky(state: BinaryLabState): BinaryLabState {
  if (!canRevealSky(state)) return state;

  return {
    ...state,
    skyVisible: true,
    revealed: true,
  };
}
