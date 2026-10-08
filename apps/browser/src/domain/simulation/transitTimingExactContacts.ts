/** Solves and diagnoses bounded ingress and egress contacts. */
import { bisectRoot } from "./transitTimingRoots";
import {
  isolateNearestContact,
  transitContactValue,
  type TransitEventSampler,
} from "./transitContactIsolation";

type TransitContactResult = {
  ingressSec?: number;
  egressSec?: number;
  ingressIterations: number;
  egressIterations: number;
  validityFlags: string[];
};

/** Solves the nearest connected ingress and egress around an in-transit seed. */
export function solveTransitContacts(args: {
  sampleAt: TransitEventSampler;
  seedSec: number;
  contactRadius: number;
  contactSpanSec: number;
}): TransitContactResult {
  const ingress = solveOneContact(args, -1);
  const egress = solveOneContact(args, 1);
  const validityFlags: string[] = [];
  if (ingress.rootSec === undefined) validityFlags.push("ingress-bracket-miss");
  if (egress.rootSec === undefined) validityFlags.push("egress-bracket-miss");
  return {
    ingressSec: ingress.rootSec,
    egressSec: egress.rootSec,
    ingressIterations: ingress.iterations,
    egressIterations: egress.iterations,
    validityFlags,
  };
}

function solveOneContact(
  args: { sampleAt: TransitEventSampler; seedSec: number; contactRadius: number; contactSpanSec: number },
  direction: -1 | 1,
): { rootSec?: number; iterations: number } {
  const endSec = args.seedSec + direction * args.contactSpanSec;
  const bracket = isolateNearestContact(args.sampleAt, args.contactRadius, args.seedSec, endSec);
  if (!bracket) return { iterations: 0 };
  const root = bisectRoot({
    fn: (time) => transitContactValue(args.sampleAt, time, args.contactRadius),
    leftSec: bracket[0],
    rightSec: bracket[1],
    tolSec: 1e-6,
    maxIters: 48,
  });
  return { rootSec: root.converged ? root.rootSec : undefined, iterations: root.iterations };
}
