/**
 * Generic one-dimensional bracket scanning and bisection helpers for transit timing.
 */

type RootSolveResult = {
  rootSec?: number;
  iterations: number;
  converged: boolean;
};

type BracketsScanResult = {
  brackets: [number, number][];
  scans: number;
};

export function findBracketsByScan(args: {
  fn: (tSec: number) => number | undefined;
  startSec: number;
  endSec: number;
  samples?: number;
}): BracketsScanResult {
  const sampleCount = Math.max(4, Math.floor(args.samples ?? 32));
  const brackets: [number, number][] = [];
  let prevT = args.startSec;
  let prevV = args.fn(prevT);

  for (let idx = 1; idx <= sampleCount; idx++) {
    const alpha = idx / sampleCount;
    const tSec = args.startSec + (args.endSec - args.startSec) * alpha;
    const val = args.fn(tSec);
    if (val === undefined) {
      prevT = tSec;
      prevV = val;
      continue;
    }
    if (val === 0) {
      brackets.push([tSec, tSec]);
    } else if (prevV !== undefined && Number.isFinite(prevV) && (prevV <= 0 ? val >= 0 : val <= 0)) {
      brackets.push([prevT, tSec]);
    }
    prevT = tSec;
    prevV = val;
  }

  return { brackets, scans: sampleCount + 1 };
}

export function bisectRoot(args: {
  fn: (tSec: number) => number | undefined;
  leftSec: number;
  rightSec: number;
  tolSec?: number;
  maxIters?: number;
}): RootSolveResult {
  let leftSec = args.leftSec;
  let rightSec = args.rightSec;
  let leftVal = args.fn(leftSec);
  const rightVal = args.fn(rightSec);
  if (leftVal === undefined || rightVal === undefined) return { iterations: 0, converged: false };
  if (leftSec === rightSec) return { rootSec: leftSec, iterations: 0, converged: true };
  if (!(Number.isFinite(leftVal) && Number.isFinite(rightVal))) return { iterations: 0, converged: false };
  if (!(leftVal <= 0 ? rightVal >= 0 : rightVal <= 0)) return { iterations: 0, converged: false };

  const tolSec = args.tolSec ?? 1e-6;
  const maxIters = args.maxIters ?? 48;

  let iterations = 0;
  for (let iter = 0; iter < maxIters && rightSec - leftSec > tolSec; iter++) {
    iterations = iter + 1;
    const midSec = (leftSec + rightSec) / 2;
    const midVal = args.fn(midSec);
    if (midVal === undefined || !Number.isFinite(midVal)) return { iterations: iter + 1, converged: false };
    if (Math.abs(midVal) <= 1e-12) return { rootSec: midSec, iterations: iter + 1, converged: true };
    if (leftVal <= 0 ? midVal >= 0 : midVal <= 0) {
      rightSec = midSec;
    } else {
      leftSec = midSec;
      leftVal = midVal;
    }
  }

  return { rootSec: (leftSec + rightSec) / 2, iterations, converged: rightSec - leftSec <= tolSec };
}
