/**
 * Performs ordered structural validation of V4 runtime configuration.
 *
 * Mirrors contracts/education-v4/scenario.schema.json: objects the schema
 * closes with `additionalProperties: false` reject unknown keys here, and
 * objects it leaves open (bodies, orbits, photometry, didactics, ...) stay open.
 */
import { isValidStaticOrbit } from "./orbitSanitizer";

type UnknownRecord = Record<string, unknown>;
type ValidationCollections = {
  stars: unknown;
  planets: unknown;
  moons: unknown;
  binary: unknown;
  hierarchy: unknown;
};
type ValidationIds = {
  starIds: Set<string>;
  planetIds: Set<string>;
  moonIds: Set<string>;
};
type IdentifiedRecord = UnknownRecord & { id: string };
type HierarchyRecord = UnknownRecord & { childId: string; parentId: string };

const STAR_FINITE_FIELDS = ["teffK", "loggCgs", "metallicityDex"] as const;
const SCENARIO_KEYS = [
  "version",
  "mode",
  "runtime",
  "observer",
  "bodies",
  "orbits",
  "photometry",
  "dynamics",
  "didactics",
  "binaryLab",
] as const;
const RUNTIME_KEYS = ["mode", "executionMode", "referenceSubsteps"] as const;
const BODIES_KEYS = ["stars", "planets", "moons"] as const;
const ORBITS_KEYS = ["binary", "hierarchy"] as const;
const HIERARCHY_KEYS = ["childId", "parentId", "relation"] as const;
const OPEN_OBJECT_FIELDS = ["observer", "photometry", "dynamics", "didactics", "binaryLab"] as const;
const isObject = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;
const isPlainObject = (value: unknown): value is UnknownRecord => isObject(value) && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const arrayOrEmpty = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isFiniteVec3 = (value: unknown): boolean =>
  isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path} has unsupported field "${key}"`);
  }
}

function collectSpectralBandpassIssues(photometry: unknown): string[] {
  if (!isObject(photometry)) return [];
  const bandpass = photometry.spectralBandpass;
  if (!isObject(bandpass) || bandpass.enabled !== true) return [];
  const lambdaNm = arrayOrEmpty(bandpass.lambdaNm);
  const weights = arrayOrEmpty(bandpass.weights);
  const issues: string[] = [];
  if (lambdaNm.length > 0 && lambdaNm.some((value) => !isFiniteNumber(value) || value <= 0)) {
    issues.push("photometry.spectralBandpass.lambdaNm entries must be finite and > 0");
  }
  if (weights.length > 0 && weights.some((value) => !isFiniteNumber(value) || value < 0)) {
    issues.push("photometry.spectralBandpass.weights entries must be finite and >= 0");
  }
  if (weights.length > 0 && weights.length !== lambdaNm.length) {
    issues.push("photometry.spectralBandpass.weights must match lambdaNm length when provided");
  }
  return issues;
}

function validateTopLevelFields(input: UnknownRecord, errors: string[]): void {
  if (input.version !== "4") errors.push('version must equal "4"');
  if (input.mode !== "general-lab" && input.mode !== "detached-binary-lab") {
    errors.push('mode must be "general-lab" or "detached-binary-lab"');
  }
  rejectUnknownKeys(input, SCENARIO_KEYS, "config", errors);
  for (const field of OPEN_OBJECT_FIELDS) {
    if (input[field] !== undefined && !isPlainObject(input[field])) {
      errors.push(`${field} must be an object when provided`);
    }
  }
  if (
    isPlainObject(input.observer) &&
    input.observer.dir !== undefined &&
    !isFiniteVec3(input.observer.dir)
  ) {
    errors.push("observer.dir must be a finite {x, y, z} vector");
  }
  errors.push(...collectSpectralBandpassIssues(input.photometry));
}

function validateRuntime(input: UnknownRecord, errors: string[]): void {
  if (input.runtime === undefined) return;
  if (!isPlainObject(input.runtime)) {
    errors.push("runtime must be an object when provided");
    return;
  }
  const runtime = input.runtime;
  rejectUnknownKeys(runtime, RUNTIME_KEYS, "runtime", errors);
  if (runtime.mode !== undefined && runtime.mode !== "realtime" && runtime.mode !== "reference") {
    errors.push('runtime.mode must be "realtime" or "reference"');
  }
  if (
    runtime.executionMode !== undefined &&
    runtime.executionMode !== "interactive" &&
    runtime.executionMode !== "scientific-browser"
  ) {
    errors.push('runtime.executionMode must be "interactive" or "scientific-browser"');
  }
  const substeps = runtime.referenceSubsteps;
  if (substeps !== undefined && (!Number.isInteger(substeps) || (substeps as number) < 1)) {
    errors.push("runtime.referenceSubsteps must be an integer >= 1 when provided");
  }
}

function validationCollections(input: UnknownRecord, errors: string[]): ValidationCollections | undefined {
  if (!isPlainObject(input.bodies)) {
    errors.push("bodies must be an object");
    return undefined;
  }
  if (!isPlainObject(input.orbits)) {
    errors.push("orbits must be an object");
    return undefined;
  }
  rejectUnknownKeys(input.bodies, BODIES_KEYS, "bodies", errors);
  rejectUnknownKeys(input.orbits, ORBITS_KEYS, "orbits", errors);
  return {
    stars: input.bodies.stars,
    planets: input.bodies.planets,
    moons: input.bodies.moons,
    binary: input.orbits.binary,
    hierarchy: input.orbits.hierarchy,
  };
}

function validateCollectionShapes(collections: ValidationCollections, errors: string[]): void {
  if (!Array.isArray(collections.stars) || collections.stars.length !== 2) {
    errors.push("bodies.stars must contain exactly two stars");
  }
  if (!Array.isArray(collections.planets)) errors.push("bodies.planets must be an array");
  if (!Array.isArray(collections.moons)) errors.push("bodies.moons must be an array");
  if (!isValidStaticOrbit(collections.binary)) errors.push("orbits.binary must be a valid complete orbit");
  if (!Array.isArray(collections.hierarchy)) errors.push("orbits.hierarchy must be an array");
}

function isKnownId(id: string, ids: ValidationIds): boolean {
  return ids.starIds.has(id) || ids.planetIds.has(id) || ids.moonIds.has(id);
}

function identifiedBody(
  value: unknown,
  kind: "star" | "planet" | "moon",
  ids: ValidationIds,
  errors: string[],
): IdentifiedRecord | undefined {
  if (!isPlainObject(value) || !isNonEmptyString(value.id)) {
    errors.push(`each ${kind} must define a non-empty id`);
    return undefined;
  }
  const record = value as IdentifiedRecord;
  if (isKnownId(record.id, ids))
    errors.push(`body id "${record.id}" must be unique across stars, planets, and moons`);
  if (!isFiniteNumber(record.r) || record.r <= 0)
    errors.push(`${kind} "${record.id}" must define finite r > 0`);
  if (record.m !== undefined && (!isFiniteNumber(record.m) || record.m < 0))
    errors.push(`${kind} "${record.id}" has invalid m (must be finite and >= 0)`);
  return record;
}

function validateStar(star: unknown, ids: ValidationIds, errors: string[]): void {
  const record = identifiedBody(star, "star", ids, errors);
  if (!record) return;
  ids.starIds.add(record.id);
  const luminosityScale = record.luminosityScale;
  if (luminosityScale !== undefined && (!isFiniteNumber(luminosityScale) || luminosityScale < 0)) {
    errors.push(`star "${record.id}" has invalid luminosityScale (must be finite and >= 0)`);
  }
  for (const field of STAR_FINITE_FIELDS) {
    if (record[field] !== undefined && !isFiniteNumber(record[field])) {
      errors.push(`star "${record.id}" has invalid ${field}`);
    }
  }
  if (record.passband !== undefined && !isNonEmptyString(record.passband)) {
    errors.push(`star "${record.id}" has invalid passband`);
  }
}

function validatePlanet(planet: unknown, ids: ValidationIds, errors: string[]): void {
  const record = identifiedBody(planet, "planet", ids, errors);
  if (!record) return;
  ids.planetIds.add(record.id);
  if (!isValidStaticOrbit(record.orbit)) {
    errors.push(`planet "${record.id}" must define a valid complete orbit`);
  }
  if (
    record.parentSystem !== undefined &&
    record.parentSystem !== "star" &&
    record.parentSystem !== "circumbinary"
  ) {
    errors.push(`planet "${record.id}" has invalid parentSystem`);
  }
  if (
    record.parentSystem !== "circumbinary" &&
    record.parentStarId !== undefined &&
    (!isNonEmptyString(record.parentStarId) || !ids.starIds.has(record.parentStarId))
  ) {
    errors.push(`planet "${record.id}" references unknown parent star "${String(record.parentStarId)}"`);
  }
}

function validateMoon(moon: unknown, ids: ValidationIds, errors: string[]): void {
  const record = identifiedBody(moon, "moon", ids, errors);
  if (!record) return;
  ids.moonIds.add(record.id);
  if (!isValidStaticOrbit(record.orbit)) {
    errors.push(`moon "${record.id}" must define a valid complete orbit`);
  }
  if (!isNonEmptyString(record.parentPlanetId) || !ids.planetIds.has(record.parentPlanetId)) {
    errors.push(`moon "${record.id}" references unknown parent planet "${String(record.parentPlanetId)}"`);
  }
}

function validateHierarchyLink(link: unknown, ids: ValidationIds, errors: string[]): void {
  if (!isPlainObject(link) || !isNonEmptyString(link.childId) || !isNonEmptyString(link.parentId)) {
    errors.push("each hierarchy link must define non-empty childId and parentId");
    return;
  }
  const record = link as HierarchyRecord;
  rejectUnknownKeys(record, HIERARCHY_KEYS, `hierarchy link "${record.childId}"`, errors);
  if (record.relation !== "orbits") {
    errors.push(`hierarchy link "${record.childId}" must use relation "orbits"`);
  }
  if (!ids.planetIds.has(record.childId) && !ids.moonIds.has(record.childId)) {
    errors.push(`hierarchy child "${record.childId}" does not reference a known planet or moon`);
  }
  if (!ids.starIds.has(record.parentId) && !ids.planetIds.has(record.parentId)) {
    errors.push(`hierarchy parent "${record.parentId}" does not reference a known star or planet`);
  }
}

function validateBodiesAndHierarchy(collections: ValidationCollections, errors: string[]): void {
  const ids: ValidationIds = { starIds: new Set(), planetIds: new Set(), moonIds: new Set() };
  if (Array.isArray(collections.stars)) {
    for (const star of collections.stars) validateStar(star, ids, errors);
  }
  if (Array.isArray(collections.planets)) {
    for (const planet of collections.planets) validatePlanet(planet, ids, errors);
  }
  if (Array.isArray(collections.moons)) {
    for (const moon of collections.moons) validateMoon(moon, ids, errors);
  }
  if (Array.isArray(collections.hierarchy)) {
    for (const link of collections.hierarchy) validateHierarchyLink(link, ids, errors);
  }
}

export function validateEducationScenarioV4(input: unknown): string[] {
  if (!isObject(input)) return ["config must be an object"];
  const errors: string[] = [];
  validateTopLevelFields(input, errors);
  validateRuntime(input, errors);
  const collections = validationCollections(input, errors);
  if (!collections) return errors;
  validateCollectionShapes(collections, errors);
  validateBodiesAndHierarchy(collections, errors);
  return errors;
}
