/** Coordinates connected contact and minimum-separation event solves. */
import { closestFrontApproach } from "./v4/nativeTransitImpact";
import type { TransitEventSampler } from "./transitContactIsolation";
import { solveTransitContacts } from "./transitTimingExactContacts";
import { findTransitCenter } from "./transitTimingExactCenter";
import { computeTtvSec } from "./transitTimingEphemeris";
import type { ExactTransitSolveArgs, TransitEventSolveResult } from "./transitTimingTypes";

/** Solves one event with connected contact isolation and a bounded front-side minimum. */
export function solveTransitEventExact(args: ExactTransitSolveArgs): TransitEventSolveResult {
  const { linear, tObsSec, rStar, rBody, sampleAt, periodSec, transitReferenceEpochSec } = args;
  const contactRadius = rStar + rBody;
  const center = findTransitCenter({ linear, tObsSec, rSum: contactRadius, periodSec, sampleAt });
  if (center.centerSec === undefined) {
    return fallback(linear, center.validityFlags, center.iterations);
  }

  const seedSec = center.observedContact < 0 ? tObsSec : center.centerSec;
  const contacts = solveTransitContacts({
    sampleAt,
    seedSec,
    contactRadius,
    contactSpanSec: contactSearchSpan(linear, tObsSec, periodSec),
  });
  if (
    contacts.ingressSec === undefined ||
    contacts.egressSec === undefined ||
    contacts.egressSec <= contacts.ingressSec
  ) {
    return fallback(
      linear,
      [...contacts.validityFlags],
      center.iterations,
      contacts.ingressIterations,
      contacts.egressIterations,
    );
  }

  return finishSolvedEvent({
    linear,
    sampleAt,
    ingressSec: contacts.ingressSec,
    egressSec: contacts.egressSec,
    periodSec,
    transitReferenceEpochSec,
    centerIterations: center.iterations,
    ingressIterations: contacts.ingressIterations,
    egressIterations: contacts.egressIterations,
  });
}

function contactSearchSpan(
  linear: ExactTransitSolveArgs["linear"],
  tObsSec: number,
  periodSec?: number,
): number {
  const maxSpanSec =
    Number.isFinite(periodSec) && (periodSec as number) > 0
      ? (periodSec as number) / 4
      : linear.durationSec * 8;
  const baseSpanSec = Math.min(
    Math.max(linear.durationSec, Math.abs(linear.centerSec - tObsSec) * 2, 1e-3),
    Math.max(maxSpanSec, 1e-3),
  );
  return Math.max(baseSpanSec, maxSpanSec);
}

function finishSolvedEvent(args: {
  linear: ExactTransitSolveArgs["linear"];
  sampleAt: TransitEventSampler;
  ingressSec: number;
  egressSec: number;
  periodSec?: number;
  transitReferenceEpochSec?: number;
  centerIterations: number;
  ingressIterations: number;
  egressIterations: number;
}): TransitEventSolveResult {
  const minimum = closestFrontApproach(args.sampleAt, args.ingressSec, args.egressSec, 64);
  if (!minimum) {
    return fallback(
      args.linear,
      ["center-minimum-failed"],
      args.centerIterations,
      args.ingressIterations,
      args.egressIterations,
    );
  }
  return {
    event: {
      centerSec: minimum.tSec,
      durationSec: args.egressSec - args.ingressSec,
      ingressSec: args.ingressSec,
      egressSec: args.egressSec,
      ttvSec: computeTtvSec(minimum.tSec, args.periodSec, args.transitReferenceEpochSec),
    },
    diagnostics: {
      status: "exact",
      converged: true,
      usedExact: true,
      centerIterations: args.centerIterations,
      ingressIterations: args.ingressIterations,
      egressIterations: args.egressIterations,
      validityFlags: [],
    },
  };
}

function fallback(
  linear: ExactTransitSolveArgs["linear"],
  validityFlags: string[],
  centerIterations: number,
  ingressIterations = 0,
  egressIterations = 0,
): TransitEventSolveResult {
  return {
    event: linear,
    diagnostics: {
      status: "fallback-linear",
      converged: false,
      usedExact: true,
      centerIterations,
      ingressIterations,
      egressIterations,
      validityFlags,
    },
  };
}
