/** Checks the V7 input examples and their cross-field scientific semantics. */
import { assertValid } from "./contract-case-helpers.mjs";

export function runV7ContractCases(corpus) {
  for (const [name, document] of corpus.documents) {
    if (!name.startsWith("science-v7/fixtures/")) continue;
    const kind = name.split("/").at(-1).replace(".json", "");
    const schema =
      kind === "workspace" ? "workspace-v2/workspace.schema.json" : `science-v7/${kind}.schema.json`;
    assertValid(corpus, schema, name, document);
  }
}

export function validateScienceV7Semantics(schemaPath, value, errors) {
  if (!value || typeof value !== "object") return;
  if (schemaPath === "science-v7/observations.schema.json") observations(value, errors);
  if (schemaPath === "science-v7/calibration.schema.json") calibration(value, errors);
  if (schemaPath === "science-v7/scenario.schema.json") scenario(value, errors);
  if (schemaPath === "science-v7/job-request.schema.json") job(value, errors);
  if (schemaPath === "science-v7/resource-descriptor.schema.json") {
    const expected = { sources: "opaque-bytes", workspaces: "workspace-v2" }[value.kind] ?? "science-v7";
    if (value.resourceSchemaVersion !== expected) errors.push("resource version does not match kind");
  }
}

function observations(value, errors) {
  const expected = {
    "relative-flux": [["flux"], ["1"]],
    "radial-velocity": [["rv"], ["m/s"]],
    "event-time": [["oc"], ["s"]],
    astrometry: [
      ["xi", "eta"],
      ["rad", "rad"],
    ],
  }[value.observable];
  if (!expected) return;
  if (JSON.stringify([value.components, value.units]) !== JSON.stringify(expected))
    errors.push("observations components/units do not match observable");
  if ((value.observable === "event-time") !== Object.hasOwn(value, "ephemeris"))
    errors.push("only event-time requires an explicit ephemeris");
  if ((value.observable === "astrometry") !== Object.hasOwn(value, "astrometricReference"))
    errors.push("only astrometry requires an explicit ICRS tangent point");
  if (value.observable === "relative-flux" && !value.calibrationHashes?.length)
    errors.push("relative flux requires a passband calibration");
  if (value.timeConvention?.scale === "UTC" && !value.timeConvention.referenceDataHashes?.length)
    errors.push("UTC requires pinned leap-second reference data");
  observationRows(value.rows, expected[0].length, value.timeConvention, errors);
}

function timeDifference(left, right) {
  return left.jd1 - right.jd1 + (left.jd2 - right.jd2);
}

function observationRows(rows, dimension, convention, errors) {
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => !row?.time)) return;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.value?.length !== dimension || row.sigma?.length !== dimension)
      errors.push("observation dimensions do not match components");
    if (index && timeDifference(row.time, rows[index - 1].time) < 0)
      errors.push("observation timestamps must be nondecreasing");
  }
  const factor = { start: 0, midpoint: -0.5, end: -1 }[convention?.exposureTimestamp];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const row of rows) {
    const duration = row.exposureSeconds / 86400;
    const start = timeDifference(row.time, rows[0].time) + factor * duration;
    minimum = Math.min(minimum, start);
    maximum = Math.max(maximum, start + duration);
  }
  if (maximum - minimum > 30 * 365.25) errors.push("exposure baseline exceeds 30 Julian years");
}

function calibration(value, errors) {
  const { wavelengthM: axis, response } = value;
  if (!Array.isArray(axis) || !Array.isArray(response)) return;
  if (axis.length !== response.length || axis.some((x, i) => i > 0 && x <= axis[i - 1]))
    errors.push("passband must have a matching strictly increasing wavelength grid");
  if (!response.some((x) => x > 0)) errors.push("passband must have positive support");
}

function scenario(value, errors) {
  if (!Array.isArray(value.bodies) || value.bodies.some((body) => !body)) return;
  if (new Set(value.bodies.map((body) => body.id)).size !== value.bodies.length)
    errors.push("scenario body identifiers must be unique");
  value.bodies.forEach((body, index) => {
    if (!Array.isArray(body.positionM)) return;
    for (const other of value.bodies.slice(0, index)) {
      if (!Array.isArray(other.positionM)) continue;
      const distance = Math.hypot(...body.positionM.map((x, i) => x - other.positionM[i]));
      if (distance <= body.radiusM + other.radiusM) errors.push("initial bodies are in surface contact");
    }
  });
}

function job(value, errors) {
  if (!value.tolerances?.allocation) return;
  // Match Python's ordered binary64 additions and allow only rounding-scale excess.
  let sum = 0;
  for (const key of ["trajectory", "propagation", "spatial", "spectral", "exposure"])
    sum += value.tolerances.allocation[key];
  if (!(sum > 0 && sum <= 1 + 1e-12))
    errors.push("numerical budget fractions must sum to at most one (roundoff allowance 1e-12)");
}
