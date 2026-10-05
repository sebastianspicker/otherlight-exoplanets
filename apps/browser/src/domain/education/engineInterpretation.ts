/**
 * Maps lesson check results and numeric signals to a learner-facing interpretation.
 */
import type { DidacticInterpretation, LessonSpec } from "../model/types";
import type { NumericSignals } from "./engineNumericSignals";

type InterpretationEvaluation = { stepId: string };

const DEPTH_RELATIVE_TOLERANCE = 0.2;
const MOON_LEAD_LAG_MIN_SEC = 600;

function formatFinite(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

/** True when a transit is observed and its depth is within 20 % of (Rp/R*)^2. */
export function depthMatchesGeometry(signals: { depthApprox: number; depthObserved: number }): boolean {
  const { depthApprox, depthObserved } = signals;
  return (
    Number.isFinite(depthApprox) &&
    depthApprox > 0 &&
    Number.isFinite(depthObserved) &&
    depthObserved > 0 &&
    Math.abs(depthObserved - depthApprox) <= DEPTH_RELATIVE_TOLERANCE * depthApprox
  );
}

function interpretKeplerDepth(signals: NumericSignals): DidacticInterpretation {
  if (!(signals.depthObserved > 0)) {
    return {
      headline: "No transit is in progress at this time.",
      observation: "The physical depth is zero, so there is nothing to compare against (Rp/R*)^2 yet.",
      nextAction: "Jump to mid-transit and read the depth there.",
    };
  }
  return depthMatchesGeometry(signals)
    ? {
        headline: "Geometry and depth now tell the same story.",
        observation: `The physical depth ${signals.depthObserved.toFixed(4)} is within 20% of the geometric estimate ${signals.depthApprox.toFixed(4)}.`,
        nextAction:
          "Use ingress and egress to explain why central transits best match the simple radius-ratio formula.",
      }
    : {
        headline: "The depth still disagrees with the simple radius-ratio estimate.",
        observation: `Observed depth ${signals.depthObserved.toFixed(4)} differs from the geometric estimate ${formatFinite(signals.depthApprox, 4)} by more than 20%.`,
        nextAction:
          "Read the depth at mid-transit and check whether the chord is grazing or limb darkening changes the occulted brightness.",
      };
}

function interpretKepler(
  evalResult: InterpretationEvaluation,
  signals: NumericSignals,
): DidacticInterpretation {
  if (!Number.isFinite(signals.bPlanet)) {
    return {
      headline: "There is no front-of-star planet transit geometry yet.",
      observation: "The current observer/orbit geometry does not define a planet impact parameter.",
      nextAction: "Raise the planet inclination until the planet passes in front of the star.",
    };
  }
  if (evalResult.stepId !== "kepler-step-1") return interpretKeplerDepth(signals);
  return signals.bPlanet <= 0.2
    ? {
        headline: "You reached a near-central transit.",
        observation: `The planet impact parameter is ${signals.bPlanet.toFixed(2)}, so the chord stays close to the stellar center.`,
        nextAction: "Keep this geometry and now compare the physical depth against (Rp/R*)^2.",
      }
    : {
        headline: "The transit is still too far from central.",
        observation: `The current impact parameter is ${signals.bPlanet.toFixed(2)}, so the chord is still too far from the center.`,
        nextAction: "Increase planet inclination to push the chord inward.",
      };
}

function interpretMoonGeometry(signals: NumericSignals): DidacticInterpretation {
  return signals.bMoon < signals.moonContactLimit
    ? {
        headline: "The moon is now in front-of-star geometry.",
        observation: `The moon impact parameter is ${signals.bMoon.toFixed(2)} < 1 + R_m/R* = ${signals.moonContactLimit.toFixed(2)}, so the moon crosses the stellar disk.`,
        nextAction:
          "Now separate the moon timing from the planet timing so the moon feature becomes readable.",
      }
    : {
        headline: "The moon is still missing the stellar disk.",
        observation: `Its closest approach b_moon = ${formatFinite(signals.bMoon, 2)} does not reach 1 + R_m/R* = ${formatFinite(signals.moonContactLimit, 2)}.`,
        nextAction:
          "Change the moon inclination or spacing until the moon also crosses in front of the star.",
      };
}

function interpretExomoon(
  evalResult: InterpretationEvaluation,
  signals: NumericSignals,
): DidacticInterpretation {
  if (evalResult.stepId === "exomoon-step-1") return interpretMoonGeometry(signals);
  if (!Number.isFinite(signals.moonLeadLagSec)) {
    return {
      headline: "The moon is not in transit at this time.",
      observation: "The lead/lag can only be read while the moon is crossing the stellar disk.",
      nextAction: "Jump to the moon mid-transit and read the offset there.",
    };
  }
  return Math.abs(signals.moonLeadLagSec) >= MOON_LEAD_LAG_MIN_SEC
    ? {
        headline: "The moon signal is no longer buried inside the planet dip.",
        observation: `The moon transit center is offset from the planet by ${signals.moonLeadLagSec.toFixed(0)} s.`,
        nextAction:
          "Compare moon-on versus moon-off to identify which shoulder or dip belongs to the moon alone.",
      }
    : {
        headline: "The moon signal still overlaps too strongly with the planet transit.",
        observation: `The moon transit center is only ${signals.moonLeadLagSec.toFixed(0)} s from the planet center.`,
        nextAction: "Increase moon spacing so the moon leads or trails the planet more clearly.",
      };
}

function interpretBinaryGeometry(signals: NumericSignals): DidacticInterpretation {
  const b = signals.bPlanet;
  const bounds = `1 - k = ${formatFinite(signals.totalEclipseLimit, 2)}, 1 + k = ${formatFinite(signals.transitContactLimit, 2)}`;
  if (!(b < signals.transitContactLimit)) {
    return {
      headline: "The two stars do not overlap on the sky.",
      observation: `The closest-approach b = ${formatFinite(b, 2)} is not below 1 + k (${bounds}).`,
      nextAction: "Use the reveal-sky step to see why the chord misses the primary star.",
    };
  }
  return b > signals.totalEclipseLimit
    ? {
        headline: "The eclipse is partial.",
        observation: `The closest-approach b = ${b.toFixed(2)} lies between ${bounds}, so the secondary never fits entirely inside the primary disk.`,
        nextAction:
          "Relate the V-shaped eclipse bottom to the partial overlap and the luminosity contrast between the two stars.",
      }
    : {
        headline: "The eclipse is total or annular.",
        observation: `The closest-approach b = ${b.toFixed(2)} is below 1 - k (${bounds}), so the smaller star lies fully inside the larger disk at mid-eclipse.`,
        nextAction: "Look for the flat eclipse bottom that a total or annular eclipse produces.",
      };
}

function interpretBinary(
  evalResult: InterpretationEvaluation,
  signals: NumericSignals,
): DidacticInterpretation {
  if (evalResult.stepId !== "binary-step-1") return interpretBinaryGeometry(signals);
  return signals.combinedFluxDrop >= 0.01
    ? {
        headline: "The combined light curve now shows a readable stellar eclipse.",
        observation: `The total binary flux drops by ${(signals.combinedFluxDrop * 100).toFixed(1)}% from the combined baseline.`,
        nextAction:
          "Use the eclipse shape and the reveal-sky step to decide whether the eclipse is partial or total.",
      }
    : {
        headline: "The binary eclipse is still too shallow to teach from cleanly.",
        observation:
          "The combined stellar flux has not dropped enough yet to make the eclipse morphology obvious.",
        nextAction: "Stay near eclipse and compare the black-box curve to the revealed geometry.",
      };
}

function interpretCurveReading(signals: NumericSignals): DidacticInterpretation {
  return signals.depthObserved > 0
    ? {
        headline: "The curve landmarks are readable.",
        observation:
          "The physical curve contains a visible drop and recovery, so ingress, mid-transit, and egress can be named from evidence rather than guesswork.",
        nextAction:
          "Use the event jumps and describe exactly what changes first on the curve and on the stellar disk at each landmark.",
      }
    : {
        headline: "There is no readable transit landmark yet.",
        observation:
          "Without an active physical transit, the light curve does not yet support landmark-based reading.",
        nextAction: "Restore a visible transit before trying to identify ingress, mid-transit, and egress.",
      };
}

function interpretLimbDarkening(signals: NumericSignals): DidacticInterpretation {
  return signals.transitCurvatureRatio >= 1.05
    ? {
        headline: "The transit bottom is visibly rounded by limb darkening.",
        observation: `With u1 + u2 = ${signals.limbDarkeningStrength.toFixed(2)}, mid-transit is ${((signals.transitCurvatureRatio - 1) * 100).toFixed(1)}% deeper than a quarter duration later; a uniform disk would give a flat bottom.`,
        nextAction: "Compare ingress/egress curvature and the mid-transit depth against (Rp/R*)^2.",
      }
    : {
        headline: "The transit bottom is still close to flat.",
        observation: `The resolved law has u1 + u2 = ${formatFinite(signals.limbDarkeningStrength, 2)}, so the disk is nearly uniform along this chord.`,
        nextAction:
          "Switch to expert mode and increase u1/u2 while keeping the planet on a transiting chord.",
      };
}

function interpretDefault(signals: NumericSignals): DidacticInterpretation {
  return signals.rvStar > 0.01
    ? {
        headline: "The system now shows a measurable dynamical signal.",
        observation: `|RV*| is ${signals.rvStar.toFixed(3)} m/s and TDV ratio is ${formatFinite(signals.tdvRatio, 4)}.`,
        nextAction:
          "Compare this setup against an unperturbed one to separate timing effects from pure photometry.",
      }
    : {
        headline: "The perturbation is still too subtle.",
        observation:
          "The current setup has not yet produced a strong enough RV or timing deviation to teach from clearly.",
        nextAction: "Increase perturber mass or shorten the relevant orbital timescale in expert mode.",
      };
}

/**
 * Map the current lesson, check results, and numeric signals to a structured
 * {@link DidacticInterpretation} with a headline, observation sentence, and next action.
 */
export function buildInterpretation(
  lesson: LessonSpec,
  evalResult: InterpretationEvaluation,
  signals: NumericSignals,
): DidacticInterpretation {
  switch (lesson.id) {
    case "kepler-geometry":
      return interpretKepler(evalResult, signals);
    case "exomoon-transit-lab":
      return interpretExomoon(evalResult, signals);
    case "binary-eclipse-lab":
      return interpretBinary(evalResult, signals);
    case "curve-reading-lab":
      return interpretCurveReading(signals);
    case "limb-darkening-lab":
      return interpretLimbDarkening(signals);
    default:
      return interpretDefault(signals);
  }
}
