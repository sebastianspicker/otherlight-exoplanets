/** Rejects a job result that does not belong to the request the Browser submitted. */
import { canonicalScientificJson } from "./canonicalJson";
import { ScienceBackendError } from "./client";
import type { ForwardRunRequest, ScienceJobResult } from "./types";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Mirrors `samples()` in services/science/science_backend/api_contract.py. */
function expectedForwardRowCount(request: ForwardRunRequest): number {
  return Math.floor((request.endOffsetSec - request.startOffsetSec) / request.sampleCadenceSec) + 1;
}

export async function assertResultMatchesRequest(
  result: ScienceJobResult,
  request: ForwardRunRequest,
): Promise<void> {
  const manifest = result.runManifest;
  const mismatch = (field: string): ScienceBackendError =>
    new ScienceBackendError(
      `The service returned a result that does not match the submitted request (${field}).`,
    );
  if (manifest.randomSeed !== request.seed) throw mismatch("randomSeed");
  // V1 manifests predate the artifact block, so only V2 carries a row count.
  if ("artifact" in manifest && manifest.artifact.rowCount !== expectedForwardRowCount(request)) {
    throw mismatch("artifact.rowCount");
  }
  if (manifest.inputHashSha256 !== (await sha256Hex(canonicalScientificJson(request)))) {
    throw mismatch("inputHashSha256");
  }
}
