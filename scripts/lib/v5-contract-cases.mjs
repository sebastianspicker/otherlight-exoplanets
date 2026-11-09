/** Runs V5 contract validation cases. */
import { assertInvalid, assertValid } from "./contract-case-helpers.mjs";

export function runV5ContractCases(corpus) {
  const get = (name) => corpus.documents.get(name);
  const cases = get("science-v5/contract-cases.json");
  assertValid(
    corpus,
    "science-v5/forward-request.schema.json",
    "V5 forward request",
    cases.validForwardRequest,
  );
  assertValid(
    corpus,
    "science-v5/run-manifest-v2.schema.json",
    "V5 run manifest",
    cases.validForwardResult.runManifest,
  );
  // The TypeScript, Swift and Python validators all reject whitespace-only ids; so must the schema.
  const blankIds = [
    ["scenario id", (request) => (request.scenario.id = " ")],
    ["body id", (request) => (request.scenario.bodies[0].id = "\t")],
    ["observer target id", (request) => (request.scenario.observer.targetBodyId = "  ")],
  ];
  for (const [label, blank] of blankIds) {
    const request = JSON.parse(JSON.stringify(cases.validForwardRequest));
    blank(request);
    assertInvalid(
      corpus,
      "science-v5/forward-request.schema.json",
      `V5 request with a blank ${label}`,
      request,
    );
  }
  const parity = get("science-v5/scipy-dop853-native-parity.json");
  assertValid(corpus, "science-v5/forward-request.schema.json", "V5 parity scenario", {
    kind: "forward",
    scenario: parity.scenario,
    startOffsetSec: 0,
    endOffsetSec: 1,
    sampleCadenceSec: 1,
    outputs: ["radial-velocity"],
    seed: 0,
  });
}
