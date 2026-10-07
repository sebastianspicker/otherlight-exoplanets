/** Runs V4 contract validation cases. */
import { assertValid } from "./contract-case-helpers.mjs";

export function runV4ContractCases(corpus) {
  const get = (name) => corpus.documents.get(name);
  assertValid(
    corpus,
    "capabilities-v1/manifest.schema.json",
    "capabilities manifest",
    get("capabilities-v1/manifest.json"),
  );
  assertValid(
    corpus,
    "education-v4/scenario-fixtures.schema.json",
    "Education V4 scenario samples",
    get("education-v4/fixtures/scenarios.json"),
  );
  assertValid(
    corpus,
    "workspace-v1/workspace.schema.json",
    "workspace fixture",
    get("workspace-v1/fixtures/education-workspace.json"),
  );
}
