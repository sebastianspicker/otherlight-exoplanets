/**
 * Builds hints, misconceptions, interpretations, and rubric checks for lesson steps.
 */
import type {
  AssessmentRubricV2,
  DidacticCheckResult,
  DidacticSignals,
  LessonPhaseSpec,
  LessonSpec,
  RubricCriterionV2,
} from "../model/types";
import type { NumericSignals } from "./engineNumericSignals";
import { depthMatchesGeometry } from "./engineInterpretation";
import { getLessonStepPhases } from "./lessons";

export { collectNumericSignals } from "./engineNumericSignals";
export { buildInterpretation } from "./engineInterpretation";

type LessonCheckRule = LessonSpec["steps"][number]["checks"][number];

const DEFAULT_RUBRIC_CRITERIA: RubricCriterionV2[] = [
  { id: "check-pass-rate", label: "Check pass rate", weight: 0.7, metric: "check-pass-rate" },
  {
    id: "depth-consistency",
    label: "Physical transit-depth consistency",
    weight: 0.3,
    metric: "depth-consistency",
  },
];

const PASSED_STATUS_BY_SIGNAL: Partial<Record<LessonCheckRule["signal"], string>> = {
  bPlanet: "The main transit chord is in the target geometry.",
  bMoon: "The moon is crossing the star from the learner's line of sight.",
  limbDarkeningStrength: "The stellar disk is clearly darker at the limb than at the center.",
  transitCurvatureRatio: "The transit bottom is rounded the way limb darkening predicts.",
  moonLeadLagSec: "The moon signal is temporally separated from the planet dip.",
  combinedFluxDrop: "The combined stellar light curve shows a measurable eclipse.",
  rvStar: "The stellar reflex velocity is large enough to be discussed.",
  tdvRatio: "Transit timing or duration is no longer static.",
};

// Pre-computed hint levels for all 8 boolean input combinations.
// buildHintLevels is called once per frame; memoizing by (checksFailed × bPlanetFinite × depthMismatch)
// eliminates three array allocations per call while keeping the return type stable (stored references
// in DidacticSignals are safe since cached objects are never mutated).
const _hintLevelsCache = new Map<string, { L1: string[]; L2: string[]; L3: string[] }>();

// A mismatch is only meaningful while a transit is observed and a geometric prediction exists.
function hasDepthMismatch(params: { depthApprox: number; depthObserved: number }): boolean {
  return (
    Number.isFinite(params.depthApprox) &&
    params.depthApprox > 0 &&
    params.depthObserved > 0 &&
    !depthMatchesGeometry(params)
  );
}

function emptyHintLevels(): { L1: string[]; L2: string[]; L3: string[] } {
  return { L1: [], L2: [], L3: [] };
}

function appendInvalidGeometryHints(out: { L1: string[]; L2: string[]; L3: string[] }): void {
  out.L1.push("Check observer direction, inclination, and whether the body is in front of the star.");
  out.L2.push("Bring the orbit into a front-of-star transit geometry before adjusting radii.");
  out.L3.push("Invalid b indicates that physical transit geometry is unavailable at this step.");
}

function appendFailedCheckHints(out: { L1: string[]; L2: string[]; L3: string[] }): void {
  out.L1.push("Change one parameter and re-check the curve.");
  out.L2.push("Compare physical vs measured mode after each parameter change.");
  out.L3.push(
    "Track depth_theory=(Rp/Rs)^2 against the physical transit depth to isolate geometry vs noise effects.",
  );
}

function appendDepthMismatchHints(out: { L1: string[]; L2: string[]; L3: string[] }): void {
  out.L2.push("Large depth mismatch suggests limb-darkening or non-central transit effects.");
  out.L3.push("Inspect ingress/egress curvature and impact parameter before tuning planet radius.");
}

function appendDefaultHints(out: { L1: string[]; L2: string[]; L3: string[] }): void {
  if (out.L1.length === 0) out.L1.push("All checks currently pass.");
  if (out.L2.length === 0) out.L2.push("Use A/B compare to confirm causal signal changes.");
  if (out.L3.length === 0) out.L3.push("Export report and validate rubric consistency across steps.");
}

/**
 * Build tiered hint strings for the current didactics state.
 *
 * Results are memoized by the three boolean inputs (8 possible combinations) so
 * repeated calls with the same state incur no allocation cost.
 */
export function buildHintLevels(params: {
  checksFailed: boolean;
  bPlanetFinite: boolean;
  depthApprox: number;
  depthObserved: number;
}): { L1: string[]; L2: string[]; L3: string[] } {
  const depthMismatch = hasDepthMismatch(params);
  const key = `${params.checksFailed}:${params.bPlanetFinite}:${depthMismatch}`;
  const hit = _hintLevelsCache.get(key);
  if (hit) return hit;

  const out = emptyHintLevels();
  if (!params.bPlanetFinite) appendInvalidGeometryHints(out);
  if (params.checksFailed) appendFailedCheckHints(out);
  if (depthMismatch) appendDepthMismatchHints(out);
  appendDefaultHints(out);

  _hintLevelsCache.set(key, out);
  return out;
}

/**
 * Derive a list of common misconceptions the learner might hold, based on current signals.
 * Returns an empty array when the state is pedagogically clear.
 */
export function buildMisconceptions(params: {
  bPlanetFinite: boolean;
  depthApprox: number;
  depthObserved: number;
}): Array<{ id: string; message: string; severity: "info" | "warn" }> {
  const out: Array<{ id: string; message: string; severity: "info" | "warn" }> = [];
  if (!params.bPlanetFinite) {
    out.push({
      id: "impact-undefined",
      message: "Assuming a valid impact parameter while front-of-star transit geometry is unavailable.",
      severity: "warn",
    });
  }
  if (hasDepthMismatch(params)) {
    out.push({
      id: "depth-equals-ratio",
      message: "Depth is treated as purely (Rp/Rs)^2 although limb-darkening/geometry can dominate.",
      severity: "info",
    });
  }
  return out;
}

/**
 * Produce a one-sentence status message for a single lesson check,
 * suitable for display in the lesson progress panel.
 */
function passedCheckStatus(signal: LessonCheckRule["signal"]): string {
  return PASSED_STATUS_BY_SIGNAL[signal] ?? "This lesson check currently passes.";
}

function failedRangeStatus(rule: LessonCheckRule, observed: number, expected: string): string {
  if (rule.signal === "bPlanet")
    return `Move the main chord closer to the stellar center. Target ${expected}.`;
  if (rule.signal === "bMoon") {
    return `Tilt the moon orbit back toward a front-of-star crossing. Target ${expected}.`;
  }
  if (rule.signal === "combinedFluxDrop") {
    return `The eclipse is still too shallow to read clearly. Current drop ${observed.toFixed(3)}; target ${expected}.`;
  }
  if (rule.signal === "limbDarkeningStrength") {
    return `Increase u1 and u2 in expert mode. Current u1 + u2 = ${formatObserved(observed)}; target ${expected}.`;
  }
  return `Keep adjusting until the observed value fits ${expected}.`;
}

function formatObserved(observed: number): string {
  return Number.isFinite(observed) ? observed.toFixed(3) : "n/a";
}

function failedBoundStatus(rule: LessonCheckRule, observed: number, expected: string): string {
  if (rule.signal === "bMoon") {
    return `The moon's closest approach b_moon = ${formatObserved(observed)} does not overlap the star. Target ${expected}.`;
  }
  return `The closest approach b = ${formatObserved(observed)} is outside ${expected}.`;
}

function failedCheckStatus(rule: LessonCheckRule, observed: number, expected: string): string {
  if (rule.kind === "range") return failedRangeStatus(rule, observed, expected);
  if (rule.kind === "signal-bound") return failedBoundStatus(rule, observed, expected);
  if (rule.kind === "distance" && rule.signal === "moonLeadLagSec") {
    return Number.isFinite(observed)
      ? "Increase moon spacing until the moon dip leads or trails the planet more clearly."
      : "The moon is not in transit now. Jump to the moon mid-transit to read the lead/lag.";
  }
  if (rule.kind === "signal-approx") {
    return observed > 0
      ? "The measured lesson signal still does not match the geometric prediction closely enough."
      : "No transit is in progress. Jump to mid-transit to read the depth.";
  }
  return `This check still fails. Compare observed=${formatObserved(observed)} with ${expected}.`;
}

function buildCheckStatusText(
  rule: LessonCheckRule,
  passed: boolean,
  observed: number,
  expected: string,
): string {
  return passed ? passedCheckStatus(rule.signal) : failedCheckStatus(rule, observed, expected);
}

export function currentStepPhases(lesson: LessonSpec, stepIndex: number): LessonPhaseSpec[] {
  return getLessonStepPhases(lesson, stepIndex);
}

export function clampIndex(value: number | undefined, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value as number), max));
}

type RuleOutcome = { passed: boolean; expected: string };
type RangeRule = Extract<LessonCheckRule, { kind: "range" }>;
type ApproxRule = Extract<LessonCheckRule, { kind: "approx" }>;
type SignalApproxRule = Extract<LessonCheckRule, { kind: "signal-approx" }>;
type SignalBoundRule = Extract<LessonCheckRule, { kind: "signal-bound" }>;
type DistanceRule = Extract<LessonCheckRule, { kind: "distance" }>;

function evaluateRangeRule(rule: RangeRule, observed: number): RuleOutcome {
  const minOk = rule.min === undefined || observed >= rule.min;
  const maxOk = rule.max === undefined || observed <= rule.max;
  return {
    passed: Number.isFinite(observed) && minOk && maxOk,
    expected: `[${rule.min ?? "-inf"}, ${rule.max ?? "+inf"}]`,
  };
}

function evaluateApproxRule(rule: ApproxRule, observed: number): RuleOutcome {
  const delta = Math.abs(observed - rule.target);
  return {
    passed: Number.isFinite(observed) && Number.isFinite(delta) && delta <= rule.tolerance,
    expected: `${rule.target} ± ${rule.tolerance}`,
  };
}

// Relative tolerance, and the observed signal must be positive (e.g. a transit is in progress).
function evaluateSignalApproxRule(
  rule: SignalApproxRule,
  observed: number,
  signals: NumericSignals,
): RuleOutcome {
  const reference = signals[rule.referenceSignal];
  const delta = Math.abs(observed - reference);
  return {
    passed:
      Number.isFinite(reference) &&
      observed > 0 &&
      Number.isFinite(delta) &&
      delta <= rule.tolerance * Math.abs(reference),
    expected: `${rule.referenceSignal} ± ${rule.tolerance * 100}%`,
  };
}

function boundValue(signals: NumericSignals, name: SignalBoundRule["above"], fallback: number): number {
  return name ? signals[name] : fallback;
}

function evaluateSignalBoundRule(
  rule: SignalBoundRule,
  observed: number,
  signals: NumericSignals,
): RuleOutcome {
  const lower = boundValue(signals, rule.above, Number.NEGATIVE_INFINITY);
  const upper = boundValue(signals, rule.below, Number.POSITIVE_INFINITY);
  const lowerText = Number.isFinite(lower) ? lower.toFixed(3) : "-inf";
  const upperText = Number.isFinite(upper) ? upper.toFixed(3) : "+inf";
  return {
    passed: Number.isFinite(observed) && !Number.isNaN(lower + upper) && observed > lower && observed < upper,
    expected: `(${lowerText}, ${upperText})`,
  };
}

function evaluateDistanceRule(rule: DistanceRule, observed: number): RuleOutcome {
  const delta = Math.abs(observed - rule.target);
  return {
    passed: Number.isFinite(observed) && Number.isFinite(delta) && delta >= rule.minAbsDelta,
    expected: `|x-${rule.target}| >= ${rule.minAbsDelta}`,
  };
}

function evaluateRule(rule: LessonCheckRule, observed: number, signals: NumericSignals): RuleOutcome {
  switch (rule.kind) {
    case "range":
      return evaluateRangeRule(rule, observed);
    case "approx":
      return evaluateApproxRule(rule, observed);
    case "signal-approx":
      return evaluateSignalApproxRule(rule, observed, signals);
    case "signal-bound":
      return evaluateSignalBoundRule(rule, observed, signals);
    default:
      return evaluateDistanceRule(rule, observed);
  }
}

/**
 * Evaluate all rubric checks for the current lesson step against `signals`.
 * Returns per-check results, an aggregate score [0, 1], pass flag, and step metadata.
 */
export function evaluateChecks(
  lesson: LessonSpec,
  stepIndex: number,
  signals: NumericSignals,
): {
  checks: DidacticCheckResult[];
  score: number;
  allChecksPassed: boolean;
  stepId: string;
  stepTitle: string;
  prompt: string;
} {
  const step = lesson.steps[clampIndex(stepIndex, Math.max(lesson.steps.length - 1, 0))];
  const checks: DidacticCheckResult[] = [];
  let passedCount = 0;

  for (const rule of step.checks) {
    const observed = signals[rule.signal];
    const { passed, expected } = evaluateRule(rule, observed, signals);
    checks.push({
      id: rule.id,
      label: rule.label,
      passed,
      observed: Number.isFinite(observed) ? observed : undefined,
      expected,
      statusText: buildCheckStatusText(rule, passed, observed, expected),
    });
    if (passed) passedCount += 1;
  }

  const score = checks.length > 0 ? passedCount / checks.length : 0;

  return {
    checks,
    score,
    allChecksPassed: checks.length > 0 && passedCount === checks.length,
    stepId: step.id,
    stepTitle: step.title,
    prompt: step.prompt,
  };
}

// Relative depth agreement; undefined (NaN) when no transit is observed or no prediction exists.
function depthConsistencyScore(depthApprox: number, depthObserved: number): number {
  if (!(Number.isFinite(depthApprox) && depthApprox > 0 && depthObserved > 0)) return Number.NaN;
  return Math.max(0, 1 - Math.min(1, Math.abs(depthObserved - depthApprox) / depthApprox));
}

type RubricBreakdownEntry = { id: string; label: string; weight: number; score: number };
type RubricMetricArgs = { checksScore: number; depthApprox: number; depthObserved: number; tdvRatio: number };

function resolveRubricCriteria(rubric: AssessmentRubricV2 | undefined): RubricCriterionV2[] {
  return Array.isArray(rubric?.criteria) && rubric!.criteria!.length > 0
    ? rubric!.criteria!
    : DEFAULT_RUBRIC_CRITERIA;
}

function resolveRubricPassScore(rubric: AssessmentRubricV2 | undefined): number {
  return Number.isFinite(rubric?.passScore) ? Math.min(1, Math.max(0, rubric!.passScore as number)) : 0.7;
}

function rubricMetricScore(metric: RubricCriterionV2["metric"], args: RubricMetricArgs): number {
  if (metric === "check-pass-rate") return Math.min(1, Math.max(0, args.checksScore));
  if (metric === "depth-consistency") return depthConsistencyScore(args.depthApprox, args.depthObserved);
  const tdvDelta = Number.isFinite(args.tdvRatio) ? Math.abs(args.tdvRatio - 1) : 0;
  return Math.min(1, tdvDelta * 10);
}

// Unscorable criteria (e.g. depth while no transit is observed) are left out of the weighting.
function rubricBreakdown(criteria: RubricCriterionV2[], args: RubricMetricArgs): RubricBreakdownEntry[] {
  const breakdown: RubricBreakdownEntry[] = [];
  for (const criterion of criteria) {
    const weight =
      Number.isFinite(criterion.weight) && criterion.weight > 0 ? (criterion.weight as number) : 0;
    if (weight <= 0) continue;
    const score = rubricMetricScore(criterion.metric, args);
    if (!Number.isFinite(score)) continue;
    breakdown.push({ id: criterion.id, label: criterion.label, weight, score });
  }
  return breakdown;
}

export function evaluateRubricV2(args: {
  rubric?: AssessmentRubricV2;
  checksScore: number;
  depthApprox: number;
  depthObserved: number;
  tdvRatio: number;
}): DidacticSignals["rubricV2"] | undefined {
  if (!(args.rubric?.enabled ?? true)) return undefined;
  const breakdown = rubricBreakdown(resolveRubricCriteria(args.rubric), args);
  const weightSum = breakdown.reduce((sum, entry) => sum + entry.weight, 0);
  if (breakdown.length === 0 || weightSum <= 0) return undefined;
  const score = breakdown.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / weightSum;
  const passScore = resolveRubricPassScore(args.rubric);
  return { score, pass: score >= passScore, passScore, breakdown };
}
