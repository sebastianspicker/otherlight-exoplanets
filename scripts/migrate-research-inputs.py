#!/usr/bin/env python3
"""Preserve original workspace/V6 files and emit explicit V7 input migration bundles."""

import argparse
import json
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/science"))

from science_backend.api_v2_dataset_validation import (  # noqa: E402
    parse_dataset_bytes,
    validate_dataset,
)
from science_backend.canonical_json import canonical_json  # noqa: E402
from science_backend.research_validation import validate_research  # noqa: E402


def workspace(payload, source_hash, provenance_hash, args):
    if payload.get("productContext", {}).get("profile") != "education":
        raise ValueError(
            "Scientific workspace conversion requires explicit epoch, frame and model mapping; no automatic conversion exists"
        )
    check = (
        'import {loadContractCorpus} from "./scripts/check-contracts.mjs";'
        'let s="";for await (const c of process.stdin)s+=c;'
        'const r=(await loadContractCorpus()).validate("workspace-v1/workspace.schema.json",JSON.parse(s));'
        'if(!r.valid){console.error(r.errors.join("\\n"));process.exit(1)}'
    )
    subprocess.run(
        ["node", "--input-type=module", "-e", check],
        cwd=ROOT,
        input=json.dumps(payload),
        text=True,
        check=True,
    )
    result = {
        "schemaVersion": "workspace-v2",
        "title": args.title,
        "sourceHashes": [source_hash],
        "provenanceHash": provenance_hash,
        "educationArchiveHash": source_hash,
        "scenarioHashes": [],
        "observationHashes": [],
        "calibrationHashes": [],
        "resultHashes": [],
    }
    validate_research("workspace-v2/workspace.schema.json", result)
    return "workspace", result


def calibration(payload, source_hash, provenance_hash, args):
    validate_dataset(payload)
    if payload.get("kind") != "passband-response" or not args.passband_weighting:
        raise ValueError(
            "Only passband-response migration is supported, with explicit --passband-weighting photon|energy; other V6 semantics need explicit model-specific mapping"
        )
    result = {
        "schemaVersion": "science-v7",
        "kind": "calibration",
        "model": "tabulated-passband-v1",
        "sourceHash": source_hash,
        "provenanceHash": provenance_hash,
        "version": args.version,
        "weighting": args.passband_weighting,
        "interpolation": "piecewise-linear",
        "outsideDomain": "reject",
        "wavelengthM": payload["wavelengthM"],
        "response": payload["response"],
    }
    validate_research("science-v7/calibration.schema.json", result)
    return "calibration", result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "destination",
        type=Path,
        help="new directory; never overwrites an existing bundle",
    )
    parser.add_argument("--citation", required=True)
    parser.add_argument("--licence", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--passband-weighting", choices=("photon", "energy"))
    args = parser.parse_args()
    with args.source.open("rb") as stream:
        source = stream.read(8 * 1024 * 1024 + 1)
    payload = parse_dataset_bytes(source)
    source_hash = sha256(source).hexdigest()
    migrations = {"workspace-v1": workspace, "science-dataset-v2": calibration}
    version = payload.get("schemaVersion")
    if version not in migrations:
        raise ValueError("Unsupported source version; no bytes were converted")
    provenance = {
        "schemaVersion": "science-v7",
        "kind": "provenance",
        "operation": f"migrate-{version}-to-v7-inputs",
        "softwareVersion": "otherlight-input-migration-1",
        "inputHashes": [source_hash],
        "citations": [args.citation],
        "licences": [args.licence],
        "notes": f"Original file: {args.source.name}; source version: {version}; no physical model execution or inferred time conversion.",
    }
    validate_research("science-v7/provenance.schema.json", provenance)
    encoded_provenance = canonical_json(provenance).encode()
    kind, migrated = migrations[version](
        payload, source_hash, sha256(encoded_provenance).hexdigest(), args
    )
    args.destination.mkdir(parents=False, exist_ok=False)
    (args.destination / "original.bin").write_bytes(source)
    (args.destination / "provenance.json").write_bytes(encoded_provenance)
    (args.destination / f"{kind}.json").write_text(canonical_json(migrated))
    print(f"Preserved {source_hash}; wrote {kind} input bundle to {args.destination}")


if __name__ == "__main__":
    main()
